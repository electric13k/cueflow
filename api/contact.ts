// Vercel twin of netlify/functions/contact.mts. Reads SLACK_WEBHOOK_URL from the project's
// environment variables; without it the form reports that it is not configured rather than failing.
export const config = { runtime: "edge" };

const LIMITS = { name: 80, email: 254, message: 4000 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Expected JSON" }, 400); }

  if (typeof body.company === "string" && body.company.trim()) return json({ ok: true }); // honeypot

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const message = String(body.message ?? "").trim();
  const topic = String(body.topic ?? "").trim() || "General";

  if (!message) return json({ error: "Please write a message." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "That email address looks wrong." }, 400);
  if (name.length > LIMITS.name || email.length > LIMITS.email || message.length > LIMITS.message) {
    return json({ error: "That's longer than the form accepts." }, 400);
  }

  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return json({ error: "Contact form is not configured yet. Try again later." }, 503);

  const res = await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `New CueFlow message, ${topic}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `CueFlow: ${topic}` } },
        { type: "section", text: { type: "mrkdwn", text: message.slice(0, LIMITS.message) } },
        { type: "context", elements: [{ type: "mrkdwn", text: `*From:* ${name || "anonymous"}${email ? ` <mailto:${email}|${email}>` : ", no reply address given"}` }] },
      ],
    }),
  });
  if (!res.ok) return json({ error: "Could not deliver that message. Try again in a moment." }, 502);
  return json({ ok: true });
}
