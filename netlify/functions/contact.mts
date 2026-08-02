import type { Config } from "@netlify/functions";

// Contact form sink. Posts to a Slack incoming webhook so the site can be reached without
// publishing anyone's address. SLACK_WEBHOOK_URL is a Netlify env var, never shipped to the client.
const LIMITS = { name: 80, email: 254, message: 4000 };

export default async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "Expected JSON" }, { status: 400 }); }

  // Honeypot: real people never fill a hidden field. Accept silently so bots learn nothing.
  if (typeof body.company === "string" && body.company.trim()) return Response.json({ ok: true });

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const message = String(body.message ?? "").trim();
  const topic = String(body.topic ?? "").trim() || "General";

  if (!message) return Response.json({ error: "Please write a message." }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "That email address looks wrong." }, { status: 400 });
  if (name.length > LIMITS.name || email.length > LIMITS.email || message.length > LIMITS.message) {
    return Response.json({ error: "That's longer than the form accepts." }, { status: 400 });
  }

  const hook = Netlify.env.get("SLACK_WEBHOOK_URL");
  if (!hook) return Response.json({ error: "Contact form is not configured yet. Try again later." }, { status: 503 });

  const res = await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `New CueFlow message, ${topic}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `CueFlow · ${topic}` } },
        { type: "section", text: { type: "mrkdwn", text: message.slice(0, LIMITS.message) } },
        { type: "context", elements: [{ type: "mrkdwn", text: `*From:* ${name || "anonymous"}${email ? ` · <mailto:${email}|${email}>` : " · no reply address given"}` }] },
      ],
    }),
  });
  if (!res.ok) return Response.json({ error: "Could not deliver that message. Try again in a moment." }, { status: 502 });
  return Response.json({ ok: true });
};

export const config: Config = { path: "/api/contact" };
