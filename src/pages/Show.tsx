import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "../ui";
import { Lock, Maximize, MessageSquare, Send, Unlock } from "lucide-react";
import ScriptReader, { AlertFlash } from "../components/ScriptReader";
import { clean, emptyDoc, type ScriptDoc } from "../lib/script";
import {
  forgetTicket, joinShow, refreshTicket, rolesForCode, savedTicket, showChannel,
  type DeckCue, type Perm, type ShowMsg, type Ticket,
} from "../lib/shows";

const can = (t: Ticket | null, p: Perm) => !!t && (t.perms ?? []).includes(p);

/** A message from another device lands as a full-screen wash and a line of text. Never a sound. */
function Flash({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-8">
      <div className="flash-message rounded-3xl bg-armed px-8 py-6 text-center text-3xl font-black text-black sm:text-5xl">{text}</div>
    </div>
  );
}

function Door({ onIn }: { onIn: (t: Ticket) => void }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(() => localStorage.getItem("cueflow:showName") ?? "");
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Only offered for a show with no password: listing the jobs of a locked show to anyone who types
  // six characters would hand out half of what the password is protecting.
  useEffect(() => {
    if (code.trim().length < 4) return setRoles([]);
    let live = true;
    void rolesForCode(code).then(r => { if (live) { setRoles(r); setRoleId(r[0]?.id ?? null); } }).catch(() => setRoles([]));
    return () => { live = false; };
  }, [code]);

  const go = async () => {
    setBusy(true); setNote("");
    try {
      localStorage.setItem("cueflow:showName", name.trim());
      onIn(await joinShow(code, password, name, roleId));
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Join a show</p>
      <h1 className="text-3xl font-black tracking-tight">Type the code</h1>
      <p className="text-sm text-muted">
        No account needed. Whoever is running the show gives you a code and tells you which job you
        are doing; what you can see and do follows from that.
      </p>
      <Input autoFocus label="Show code" value={code} onValueChange={v => setCode(v.trim())}
        className="font-mono" placeholder="K7QM2X" />
      <Input label="Your name" value={name} onValueChange={setName} placeholder="Sam on sound" />
      <Input type="password" label="Password (if the show has one)" value={password} onValueChange={setPassword} autoComplete="off" />
      {roles.length > 0 && (
        <label className="text-sm">
          <span className="text-muted">Your job</span>
          <select value={roleId ?? ""} onChange={e => setRoleId(e.target.value || null)}
            className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-foreground">
            {roles.map(r => <option key={r.id} value={r.id} className="bg-background">{r.name}</option>)}
          </select>
        </label>
      )}
      {note && <p className="text-sm text-live">{note}</p>}
      <Button color="primary" isLoading={busy} isDisabled={code.trim().length < 4} onPress={go}>Go in</Button>
      <p className="text-xs text-muted">
        A show with a password does not list its jobs until you are through the door — the host will
        assign you one.
      </p>
    </div>
  );
}

export default function Show() {
  const [ticket, setTicket] = useState<Ticket | null>(savedTicket);
  const [cues, setCues] = useState<DeckCue[]>([]);
  const [index, setIndex] = useState(-1);
  const [started, setStarted] = useState<string | null>(null);
  const [stage, setStage] = useState<{ url: string; kind: string; label: string } | null>(null);
  const [doc, setDoc] = useState<ScriptDoc>(emptyDoc);
  const [flash, setFlash] = useState("");
  const [outgoing, setOutgoing] = useState("");
  const [note, setNote] = useState("");
  const bus = useRef<{ send: (m: ShowMsg) => void; close: () => void } | null>(null);
  const flashTimer = useRef(0);

  const show = (text: string) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(""), 2600);
  };

  // The ticket is only a member id; what it is worth can change while you hold it, because the host
  // can rewrite a role mid-show. Ask again on every load rather than trusting the saved copy.
  useEffect(() => {
    if (!ticket) return;
    void refreshTicket(ticket.member).then(fresh => {
      if (!fresh) { forgetTicket(); setTicket(null); return; }
      setTicket(fresh); setStarted(fresh.started);
    });
  }, [ticket?.member]);

  useEffect(() => {
    if (!ticket) return;
    const channel = showChannel(ticket.show, msg => {
      if (msg.type === "deck") {
        setCues(msg.cues); setIndex(msg.index); setStage(msg.stage ?? null);
        // Arrives from another device, so it is untrusted markup: sanitise before it can be rendered.
        if (msg.script !== undefined) setDoc(d => ({ ...d, html: clean(msg.script ?? ""), name: d.name || "Script" }));
      }
      if (msg.type === "cue") { setIndex(msg.index); setNote(`Cue ${msg.label}`); }
      if (msg.type === "start") { setStarted(msg.at); show("Standby — show is live"); }
      if (msg.type === "end") { setStarted(null); setNote("Show ended"); }
      if (msg.type === "flash") show(msg.text);
    });
    bus.current = channel;
    channel.send({ type: "here", who: "device", role: ticket.role });
    return () => { channel.close(); bus.current = null; };
  }, [ticket?.show]);

  // Locked in: once the show starts, the screen is the show and nothing else. Fullscreen is a
  // request, not a command -- a browser can refuse it, so the layout does the work either way.
  useEffect(() => {
    if (!started) return;
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }, [started]);

  const marked = useMemo(() => doc, [doc]);
  if (!ticket) return <Door onIn={t => { setTicket(t); setStarted(t.started); }} />;

  const sendFlash = () => {
    if (!outgoing.trim()) return;
    bus.current?.send({ type: "flash", text: outgoing.trim(), from: ticket.role ?? "crew" });
    show(outgoing.trim());
    setOutgoing("");
  };

  return (
    <div className="flex h-screen flex-col gap-3 bg-background p-4 text-foreground">
      <Flash text={flash} />
      <AlertFlash level={null} />
      {started && <div aria-hidden className="live-frame" />}

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-black tracking-tight">{ticket.name}</h1>
          <p className="text-xs text-muted">
            {ticket.role ?? "No job assigned"} · {started ? "live" : "standing by"}{note ? ` · ${note}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {started
            ? <span className="flex items-center gap-1 text-xs text-live"><Lock size={13} />Locked in</span>
            : <span className="flex items-center gap-1 text-xs text-muted"><Unlock size={13} />Not started</span>}
          <Button isIconOnly size="sm" variant="light" aria-label="Full screen"
            onPress={() => void document.documentElement.requestFullscreen?.().catch(() => {})}><Maximize size={15} /></Button>
          {!started && <Button size="sm" variant="light" onPress={() => { forgetTicket(); setTicket(null); }}>Leave</Button>}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        {can(ticket, "cues") && (
          <section className="glass min-h-0 overflow-auto p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-muted">Running order</h2>
            {cues.length === 0 && <p className="text-sm text-muted">Waiting for the host to send the deck…</p>}
            <ol className="space-y-1">
              {cues.map((cue, i) => (
                <li key={cue.id} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${i === index ? "bg-live/20 ring-1 ring-live" : "bg-white/5"}`}>
                  <span className={`w-7 shrink-0 text-center font-mono font-bold ${cue.kind === "audio" ? "text-audio" : "text-visual"}`}>{cue.number}</span>
                  {can(ticket, "edit") ? (
                    // Renaming is the edit that actually happens mid-show. The host's copy is the
                    // real one, so it goes over the channel and is applied there, not here.
                    <button type="button" className="min-w-0 flex-1 truncate text-left underline decoration-dotted underline-offset-4"
                      onClick={() => {
                        const label = prompt("Rename this cue", cue.label);
                        if (label && label !== cue.label) {
                          bus.current?.send({ type: "relabel", id: cue.id, label, from: ticket.role ?? "crew" });
                          setCues(cs => cs.map(c => (c.id === cue.id ? { ...c, label } : c)));
                        }
                      }}>{cue.label}</button>
                  ) : <span className="min-w-0 flex-1 truncate">{cue.label}</span>}
                  {can(ticket, "fire") && (
                    <Button size="sm" variant="flat" onPress={() => bus.current?.send({ type: "fire", index: i, from: ticket.role ?? "crew" })}>Go</Button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {can(ticket, "script") && (
          <section className="glass flex min-h-0 flex-col p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-muted">Script</h2>
            <div className="min-h-0 flex-1">
              <ScriptReader doc={marked} setDoc={setDoc} />
            </div>
          </section>
        )}

        {can(ticket, "stage") && (
          <section className="glass flex min-h-0 flex-col p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-muted">On the screen</h2>
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-black/40">
              {!stage && <p className="text-sm text-muted">Nothing up.</p>}
              {stage?.kind === "video"
                ? <video src={stage.url} className="max-h-full max-w-full" muted autoPlay playsInline />
                : stage && <img src={stage.url} alt={stage.label} className="max-h-full max-w-full object-contain" />}
            </div>
          </section>
        )}

        {!can(ticket, "cues") && !can(ticket, "script") && !can(ticket, "stage") && (
          <section className="glass flex items-center justify-center p-8 text-center text-sm text-muted lg:col-span-2">
            You are in. Your job does not need the cue list or the script — messages will still reach you.
          </section>
        )}
      </div>

      {can(ticket, "message") && (
        <div className="flex gap-2">
          <MessageSquare size={18} className="mt-3 shrink-0 text-muted" aria-hidden />
          <Input className="flex-1" value={outgoing} onValueChange={setOutgoing} placeholder="Flash a line to everyone"
            onKeyDown={e => { if (e.key === "Enter") sendFlash(); }} />
          <Button color="primary" isIconOnly aria-label="Send" onPress={sendFlash}><Send size={16} /></Button>
        </div>
      )}
    </div>
  );
}
