import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * The retention sweep. Runs once a day from pg_cron.
 *
 * Three jobs, in this order:
 *   1. guests: an upload with no owner goes 30 days after it landed. Nobody can be warned, because
 *      a guest upload carries no address, which is exactly why its clock is short.
 *   2. warn: an account quiet for 335 days gets one email, and a deadline 30 days out is written
 *      down. Coming back clears the notice, so the mail can only ever be sent once per idle spell.
 *   3. delete: an account past its deadline loses its files, its rows and its login.
 *
 * Nothing is deleted that was not warned first, and the warning is checked against the account's
 * own last_seen_at at deletion time, so a person who signed in the day after the mail keeps
 * everything even if this function is a week late running.
 */

const BUCKET = "audio";
const GUEST_PREFIX = "public";
const GUEST_DAYS = 30;
const ACCOUNT_DAYS = 365;
const NOTICE_DAYS = 30;
const DAY = 86_400_000;

const SITE = Deno.env.get("SITE_URL") ?? "https://cuefloww.netlify.app";
const FROM = Deno.env.get("RETENTION_FROM") ?? "CueFlow <onboarding@resend.dev>";
const RESEND = Deno.env.get("RESEND_API_KEY");

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

/** The one branded template. Plain tables and inline styles, because that is what mail clients read. */
function noticeEmail(days: number, deadline: string) {
  const when = new Date(deadline).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#F3E9D8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3E9D8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FBF5EA;border:1px solid #E3D4BC;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#6E2029;padding:20px 28px;">
        <span style="font:700 20px/1.2 Georgia,'Times New Roman',serif;color:#F3E9D8;letter-spacing:.02em;">CueFlow</span>
        <span style="font:400 12px/1.2 Georgia,serif;color:#E7C9B0;padding-left:10px;">Stand by. Go.</span>
      </td></tr>
      <tr><td style="padding:28px;font:400 16px/1.6 Georgia,'Times New Roman',serif;color:#2B2420;">
        <h1 style="margin:0 0 14px;font:700 22px/1.3 Georgia,serif;color:#6E2029;">Your library goes quiet in ${days} days</h1>
        <p style="margin:0 0 14px;">Nobody has opened this CueFlow account for eleven months. On <strong>${when}</strong> the sounds, slides, sequences and scripts in it are deleted, and that cannot be undone.</p>
        <p style="margin:0 0 22px;">Two ways to keep it, and either one is enough:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
          <tr><td style="padding-bottom:10px;">
            <a href="${SITE}/studio" style="display:inline-block;background:#46583A;color:#F3E9D8;text-decoration:none;font:700 15px/1 Georgia,serif;padding:13px 22px;border-radius:10px;">Open CueFlow and keep everything</a>
          </td></tr>
          <tr><td>
            <a href="${SITE}/account" style="display:inline-block;border:1px solid #6E2029;color:#6E2029;text-decoration:none;font:700 15px/1 Georgia,serif;padding:12px 21px;border-radius:10px;">Download it all as a zip</a>
          </td></tr>
        </table>
        <p style="margin:0 0 6px;font-size:14px;color:#5B5048;">Signing in resets the clock for another year. The zip holds your files and your cue lists as plain JSON, readable without CueFlow.</p>
      </td></tr>
      <tr><td style="padding:16px 28px 24px;border-top:1px solid #E3D4BC;font:400 12px/1.6 Georgia,serif;color:#7A6E63;">
        Sent once, because this account has been idle. <a href="${SITE}/privacy" style="color:#6E2029;">How long CueFlow keeps things</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

const noticeText = (days: number, deadline: string) =>
  `Your CueFlow library is deleted in ${days} days, on ${new Date(deadline).toDateString()}.\n\n` +
  `Keep it by opening ${SITE}/studio, or download everything as a zip at ${SITE}/account.\n` +
  `Signing in resets the clock for another year.`;

async function send(to: string, subject: string, html: string, text: string) {
  if (!RESEND) return { sent: false, reason: "no RESEND_API_KEY" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html, text }),
  });
  return { sent: res.ok, reason: res.ok ? "" : `${res.status} ${await res.text()}` };
}

/** Every stored path a user owns, so a deletion takes the blobs and not just the rows. */
async function pathsOf(userId: string) {
  const { data } = await admin.from("tracks").select("storage_path").eq("user_id", userId);
  return (data ?? []).map(r => r.storage_path).filter(Boolean) as string[];
}

async function sweepGuests() {
  const cutoff = Date.now() - GUEST_DAYS * DAY;
  const doomed: string[] = [];
  // The list API pages, and a busy month can be more than one page.
  for (let page = 0; page < 20; page++) {
    const { data, error } = await admin.storage.from(BUCKET)
      .list(GUEST_PREFIX, { limit: 100, offset: page * 100, sortBy: { column: "created_at", order: "asc" } });
    if (error || !data?.length) break;
    for (const o of data) {
      const at = new Date(o.created_at ?? o.updated_at ?? Date.now()).getTime();
      if (at <= cutoff) doomed.push(`${GUEST_PREFIX}/${o.name}`);
    }
    if (data.length < 100) break;
  }
  // A guest upload that an account later claimed is somebody's asset now, so it is not a guest file.
  const claimed = new Set<string>();
  if (doomed.length) {
    const { data } = await admin.from("tracks").select("storage_path").in("storage_path", doomed);
    for (const r of data ?? []) if (r.storage_path) claimed.add(r.storage_path);
  }
  const remove = doomed.filter(p => !claimed.has(p));
  if (remove.length) await admin.storage.from(BUCKET).remove(remove);
  return { scanned: doomed.length, deleted: remove.length };
}

async function warn() {
  const soon = new Date(Date.now() - (ACCOUNT_DAYS - NOTICE_DAYS) * DAY).toISOString();
  const { data: idle } = await admin.from("profiles").select("id,last_seen_at").lt("last_seen_at", soon);
  let sent = 0, skipped = 0;
  for (const p of idle ?? []) {
    const { data: had } = await admin.from("retention_notices").select("user_id").eq("user_id", p.id).maybeSingle();
    if (had) continue;
    const { data: u } = await admin.auth.admin.getUserById(p.id);
    const to = u.user?.email;
    const deadline = new Date(new Date(p.last_seen_at).getTime() + ACCOUNT_DAYS * DAY).toISOString();
    const days = Math.max(1, Math.ceil((new Date(deadline).getTime() - Date.now()) / DAY));
    if (!to) { skipped++; continue; }
    const out = await send(to, `Your CueFlow library is deleted in ${days} days`, noticeEmail(days, deadline), noticeText(days, deadline));
    // Only write the notice down if it actually went. An unsent warning must never start the clock.
    if (out.sent) { await admin.from("retention_notices").upsert({ user_id: p.id, deadline }); sent++; }
    else skipped++;
  }
  return { sent, skipped };
}

async function reap() {
  const { data: notices } = await admin.from("retention_notices").select("user_id,deadline").lt("deadline", new Date().toISOString());
  let deleted = 0, spared = 0;
  for (const n of notices ?? []) {
    const { data: p } = await admin.from("profiles").select("last_seen_at").eq("id", n.user_id).maybeSingle();
    const back = p && Date.now() - new Date(p.last_seen_at).getTime() < ACCOUNT_DAYS * DAY;
    if (back) { await admin.from("retention_notices").delete().eq("user_id", n.user_id); spared++; continue; }
    const paths = await pathsOf(n.user_id);
    if (paths.length) await admin.storage.from(BUCKET).remove(paths);
    // Rows hang off auth.users by foreign key with on delete cascade, so the account goes last.
    await admin.auth.admin.deleteUser(n.user_id);
    deleted++;
  }
  return { deleted, spared };
}

Deno.serve(async () => {
  const started = Date.now();
  const guests = await sweepGuests();
  const warned = await warn();
  const reaped = await reap();
  const body = { guests, warned, reaped, ms: Date.now() - started };
  console.log("retention", JSON.stringify(body));
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
});
