import { useEffect, useState } from "react";
import { CircleCheck, Send, User } from "lucide-react";
import { Button, Input } from "../ui";
import { onAuth } from "../lib/store";

const topics = ["General", "Bug report", "Feature idea", "Delete my account"] as const;

/**
 * Contact form. Deliberately friction-free: no account, no email client, no captcha, one topic
 * chip, a message, and an optional reply address. Messages land in Slack via /api/contact, so no
 * personal address has to be published on the site.
 */
export default function ContactForm() {
  const [topic, setTopic] = useState<string>(topics[0]);
  const [form, setForm] = useState({ name: "", email: "", message: "", company: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [account, setAccount] = useState<string | null>(null);

  // Signed in? Then we already know where to reply. Asking again is friction for nothing.
  useEffect(() => onAuth(setAccount), []);
  const replyTo = account ?? form.email;

  const send = async () => {
    setError("");
    if (!form.message.trim()) { setError("Add a message first."); return; }
    setState("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, email: replyTo, name: account ? "" : form.name, topic }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send that. Try again in a moment.");
      setState("sent");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  };

  if (state === "sent") return (
    <div className="glass-soft mt-4 flex items-start gap-3 p-5">
      <CircleCheck size={20} className="mt-0.5 shrink-0 text-success" />
      <div>
        <p className="font-semibold">Message sent.</p>
        <p className="mt-1 text-sm text-muted">
          {replyTo ? `We'll reply to ${replyTo}.` : "Add an email next time if you'd like a reply."}
        </p>
        <Button size="sm" variant="light" className="mt-2 px-0" onPress={() => { setForm({ name: "", email: "", message: "", company: "" }); setState("idle"); }}>
          Send another
        </Button>
      </div>
    </div>
  );

  return (
    <div className="glass-soft mt-4 p-5">
      <ol className="space-y-4">
        <li>
          <p className="text-sm font-semibold"><span className="text-accent">1.</span> What's this about?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {topics.map(t => (
              <button key={t} onClick={() => setTopic(t)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${topic === t ? "border-accent bg-accent/15 text-accent" : "border-white/10 text-muted hover:border-white/25"}`}>
                {t}
              </button>
            ))}
          </div>
        </li>
        <li>
          <p className="text-sm font-semibold"><span className="text-accent">2.</span> Tell us what happened</p>
          <textarea
            value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            rows={4} maxLength={4000} placeholder="As much or as little detail as you like."
            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[.03] p-3 text-sm outline-none placeholder:text-muted focus:border-accent/50"
          />
        </li>
        <li>
          <p className="text-sm font-semibold"><span className="text-accent">3.</span> Where should we reply? {!account && <span className="font-normal text-muted">(optional)</span>}</p>
          {account ? (
            <p className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.03] px-3 py-2.5 text-sm">
              <User size={15} className="shrink-0 text-accent" /> Your account, <b className="font-semibold">{account}</b>. Nothing to fill in.
            </p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Input placeholder="Name" value={form.name} onValueChange={v => setForm(f => ({ ...f, name: v }))} />
              <Input type="email" placeholder="you@example.com" autoComplete="email" value={form.email} onValueChange={v => setForm(f => ({ ...f, email: v }))} />
            </div>
          )}
        </li>
      </ol>

      {/* Honeypot, hidden from people, catnip for bots. */}
      <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />

      {error && <p className="mt-3 text-xs text-warning">{error}</p>}
      <Button color="primary" className="mt-4" isLoading={state === "sending"} isDisabled={state === "sending"} startContent={<Send size={16} />} onPress={send}>
        Send message
      </Button>
    </div>
  );
}
