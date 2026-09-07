import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input } from "../ui";
import { Lock, Maximize, MessageSquare, Send, Unlock, Volume2, VolumeX, X } from "lucide-react";
import ScriptReader, { AlertFlash } from "../components/ScriptReader";
import DarkToggle from "../components/DarkToggle";
import CurtainTransition from "../components/CurtainTransition";
import Stage from "../components/Stage";
import { clean, emptyDoc, type ScriptDoc } from "../lib/script";
import { themeClass, useStudioTheme } from "../lib/theme";
import { defaultEffects, defaultVisual, type Effects, type Kind, type Stage as StageState } from "../types";
import { VoicePool } from "../lib/audio";
import {
  forgetTicket, joinShow, listShows, refreshTicket, savedTicket,
  type DeckCue, type Perm, type ShowMsg, type Ticket,
} from "../lib/shows";
import { useShowLink } from "../lib/showLink";
import { currentProject } from "../lib/projects";
import { getProfile } from "../lib/account";
import { supabase } from "../lib/store";

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

function Door({ onIn, onClose, initialKey = "" }: { onIn: (t: Ticket) => void; onClose: () => void; initialKey?: string }) {
  const [key, setKey] = useState(initialKey);
  const [name, setName] = useState(() => localStorage.getItem("cueflow:showName") ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true); setNote("");
    try {
      localStorage.setItem("cueflow:showName", name.trim());
      onIn(await joinShow(key, name));
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="show-join-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div data-app role="dialog" aria-modal="true" aria-labelledby="join-show-title" aria-describedby="join-show-description"
        tabIndex={-1} className="show-join-dialog glass relative mx-4 my-6 w-full max-w-xl p-6 sm:p-8"
        onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
        <Button isIconOnly size="sm" variant="light" aria-label="Close join a show" title="Close" className="absolute right-3 top-3 z-10"
          onPress={onClose}><X size={17} /></Button>
        <div className="pr-10">
          <p className="eyebrow text-accent">Join a show</p>
          <h1 id="join-show-title" className="mt-2 text-3xl font-black tracking-tight">Type your key</h1>
          <p id="join-show-description" className="mt-2 text-sm text-muted">
            No account needed. Whoever is running the show gives you a key, and the key is the job, type
            it and you are on followspot, or on sound, or holding the whole thing. Nothing to choose.
          </p>
        </div>
        <div className="mt-5 space-y-4">
          <Input autoFocus label="Your key" value={key} onValueChange={v => setKey(v.trim())}
            className="font-mono" placeholder="K7QM2X" onKeyDown={e => { if (e.key === "Enter") void go(); }} />
          <Input label="Your name" value={name} onValueChange={setName} placeholder="Sam on sound" />
          {note && <p className="text-sm text-live">{note}</p>}
          <Button color="primary" isLoading={busy} isDisabled={key.trim().length < 4} onPress={go}>Go in</Button>
          <p className="text-xs text-muted">
            Lost it, or it stopped working? Ask whoever is running the show, they can hand out a new one,
            and the old one dies the moment they do.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Show() {
  // Whatever job you hold, the screen you hold it on is yours: the toggle is on this page for every
  // role, not just the host, and what it writes never leaves the device.
  const navigate = useNavigate();
  const requestedParams = new URLSearchParams(location.search);
  const requestedShow = requestedParams.get("show");
  const requestedKey = requestedParams.get("key") ?? "";
  const saved = savedTicket();
  const closeDoor = () => { if (window.history.length > 1) navigate(-1); else navigate("/studio"); };
  const [theme] = useStudioTheme();
  const [ticket, setTicket] = useState<Ticket | null>(() => saved && (!requestedShow || saved.show === requestedShow) ? saved : null);
  const [cues, setCues] = useState<DeckCue[]>([]);
  const [index, setIndex] = useState(-1);
  const [started, setStarted] = useState<string | null>(null);
  const [curtain, setCurtain] = useState(false);
  const curtainTimer = useRef<number | null>(null);
  const [stage, setStage] = useState<StageState>(null);
  const [doc, setDoc] = useState<ScriptDoc>(emptyDoc);
  const [flash, setFlash] = useState("");
  const [outgoing, setOutgoing] = useState("");
  const [note, setNote] = useState("");
  /** The sequence the deck came from, sent back with every `fire` so the host cannot misindex it. */
  const [deckSequence, setDeckSequence] = useState("");
  /**
   * A stage video arrives muted. The host's own setting used to be discarded and rebuilt with
   * `defaultVisual()`, which is `muted: false`, so every crew phone in the wings played the
   * soundtrack out loud -- the exact opposite of what a device in a dark auditorium should do.
   * Whether this device wants to hear it is this device's business, so the toggle is local.
   */
  const [hearStage, setHearStage] = useState(false);
  /**
   * What the host has said about this device. `null` until it says anything, which is the same as
   * being in -- a show with no admission never sends a `door` at all, and a key has always been
   * enough on its own.
   */
  const [door, setDoor] = useState<{ state: "waiting" | "in" | "out"; note?: string } | null>(null);
  /**
   * Cue sound, on this device.
   *
   * A crew screen mounted no audio at all: the sound only ever came out of whichever machine the
   * file happened to be stored on, so the person calling the cue from their phone heard nothing and
   * had no way of telling whether it had gone out. The host sends the URL to anyone holding `fire`,
   * and this plays it here.
   *
   * A browser will not start audio before the person has pressed something, and the press has to be
   * the same gesture that builds the context -- so there is an explicit control rather than a guess.
   */
  const voices = useRef(new VoicePool(4));
  const [soundOn, setSoundOn] = useState(false);
  const [soundNote, setSoundNote] = useState("");
  const cuesRef = useRef<DeckCue[]>([]);
  const soundOnRef = useRef(false); soundOnRef.current = soundOn;
  /**
   * What the room should call this device.
   *
   * It used to be whatever was typed into the join box on this browser, once, and it stayed that
   * way for ever -- so an operator who changed their username still appeared in every show under
   * the old one. A signed-in account's own name wins, and changing it re-announces to the room.
   */
  const [myName, setMyName] = useState(() => localStorage.getItem("cueflow:showName") ?? "");
  const myNameRef = useRef(myName); myNameRef.current = myName;
  useEffect(() => {
    void getProfile().then(profile => {
      const named = profile?.displayName?.trim() || profile?.username?.trim();
      if (named) setMyName(named);
    }).catch(() => undefined);
  }, []);
  const flashTimer = useRef(0);

  const playCueHere = (cue: DeckCue | undefined) => {
    if (!cue?.url || cue.kind !== "audio") return;
    if (!soundOnRef.current) { setSoundNote("Turn sound on to hear cues on this device."); return; }
    const voice = voices.current.claim(cue.id);
    if (voice.element.src !== cue.url) { voice.element.src = cue.url; voice.element.load(); }
    voice.element.currentTime = 0;
    const effects = (cue.effects as Effects | undefined) ?? defaultEffects();
    voice.engine.play(voice.element, effects).catch(() => {
      voices.current.release(voice);
      setSoundNote("This device would not play that cue.");
    });
  };
  /** The gesture the browser needs. Playing the armed cue proves it worked, rather than claiming it. */
  const enableSound = () => {
    setSoundOn(true);
    soundOnRef.current = true;
    setSoundNote("");
  };

  useEffect(() => {
    if (ticket || !requestedShow) return;
    let cancelled = false;
    void (async () => {
      if (!supabase) return null;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const shows = await listShows(currentProject());
      const owned = shows.find(item => item.id === requestedShow && item.owner === user.id);
      if (!owned?.password) return null;
      return joinShow(owned.password, localStorage.getItem("cueflow:showName")?.trim() || "Operator");
    })().then(next => {
      if (!cancelled && next) { setTicket(next); setStarted(next.started); }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [ticket, requestedShow]);

  const show = (text: string) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(""), 2600);
  };
  const startCurtain = () => {
    if (curtainTimer.current) window.clearTimeout(curtainTimer.current);
    setCurtain(true);
    curtainTimer.current = window.setTimeout(() => setCurtain(false), 1400);
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

  const onShowMsg = (msg: ShowMsg) => {
    if (msg.type === "deck") {
      // A deck can be addressed: the host tailors it to one member's perms. One meant for somebody
      // else is not ours to apply, and applying it would blank a list we can legitimately see.
      if (msg.to && msg.to !== ticketRef.current?.member) return;
      setDeckSequence(msg.sequence ?? "");
      setCues(msg.cues); cuesRef.current = msg.cues; setIndex(msg.index);
      setStage(msg.stage ? { ...msg.stage, kind: msg.stage.kind as Kind, visual: { ...defaultVisual(), muted: true }, n: Date.now() } : null);
      // Arrives from another device, so it is untrusted markup: sanitise before it can be rendered.
      if (msg.script !== undefined) setDoc(d => ({ ...d, html: clean(msg.script ?? ""), name: d.name || "Script" }));
    }
    if (msg.type === "cue") { setIndex(msg.index); setNote(`Cue ${msg.label}`); playCueHere(cuesRef.current[msg.index]); }
    if (msg.type === "start") { setStarted(msg.at); startCurtain(); show("Standby, show is live"); }
    if (msg.type === "end") { setStarted(null); setNote("Show ended"); voices.current.stopAll(); }
    if (msg.type === "flash") show(msg.text);
    if (msg.type === "door") {
      if (msg.member !== ticketRef.current?.member) return;
      setDoor({ state: msg.state, note: msg.note });
      if (msg.state === "out") { setCues([]); setDoc(emptyDoc()); setStage(null); voices.current.stopAll(); }
      // A job can be rewritten while the show runs, and until now the change only reached a device
      // that happened to reload -- so somebody could still be holding powers already taken away.
      if (msg.perms) {
        setTicket(held => (held ? { ...held, role: msg.role ?? held.role, perms: msg.perms ?? held.perms } : held));
      }
    }
  };
  const ticketRef = useRef(ticket); ticketRef.current = ticket;
  const handlerRef = useRef(onShowMsg); handlerRef.current = onShowMsg;
  /**
   * `here` is what asks the host for the deck, and it used to be sent the instant the channel object
   * existed -- before the socket had joined -- so it was routinely dropped and the device sat on
   * "Waiting for the host to send the deck" for the rest of the night. The link queues it until it
   * is actually connected, and re-sends it on every reconnect.
   */
  const link = useShowLink(
    ticket?.show ?? null,
    msg => handlerRef.current(msg),
    () => {
      const held = ticketRef.current;
      return held ? { type: "here", who: myNameRef.current || held.name, role: held.role, member: held.member } : null;
    },
  );
  const bus = { send: link.send };
  // Re-announce when the name changes, so the host's roster follows a rename rather than keeping
  // whatever was typed into the join box the first time this browser joined anything.
  useEffect(() => {
    const held = ticketRef.current;
    if (!held || !link.ready || !myName) return;
    link.send({ type: "here", who: myName, role: held.role, member: held.member });
  }, [myName, link.ready]);

  useEffect(() => () => { if (curtainTimer.current) window.clearTimeout(curtainTimer.current); }, []);

  // Locked in: once the show starts, the screen is the show and nothing else. Fullscreen is a
  // request, not a command -- a browser can refuse it, so the layout does the work either way.
  useEffect(() => {
    if (!started) return;
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }, [started]);

  const marked = useMemo(() => doc, [doc]);
  if (!ticket) return <Door initialKey={requestedKey} onClose={closeDoor} onIn={t => { setTicket(t); setStarted(t.started); }} />;

  if (door && door.state !== "in") {
    const refused = door.state === "out";
    return (
      <div className={`${themeClass(theme)} flex h-dvh flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground`}>
        <p className="eyebrow text-accent">{refused ? "Not in this show" : "Waiting room"}</p>
        <h1 className="max-w-md text-3xl font-black tracking-tight">
          {refused ? "You were not let in." : "Standing by to be let in."}
        </h1>
        <p className="max-w-md text-sm text-muted">
          {door.note ?? (refused
            ? "Ask whoever is running the show if you think that is wrong."
            : "Whoever is running the show can see you at the door. This screen changes on its own.")}
        </p>
        <div className="flex gap-2">
          {!refused && <span aria-live="polite" className="flex items-center gap-2 text-xs text-muted"><span className="armed-dot h-2 w-2 rounded-full bg-armed" />Still waiting</span>}
          <Button size="sm" variant="light" onPress={() => { forgetTicket(); setTicket(null); setDoor(null); }}>Leave</Button>
        </div>
      </div>
    );
  }

  const sendFlash = () => {
    if (!outgoing.trim()) return;
    bus.send({ type: "flash", text: outgoing.trim(), from: ticket.role ?? "crew", member: ticket.member });
    show(outgoing.trim());
    setOutgoing("");
  };

  return (
    <div className={`${themeClass(theme)} flex h-screen flex-col gap-3 bg-background p-4 text-foreground`}>
      <Flash text={flash} />
      <CurtainTransition open={curtain} />
      <AlertFlash level={null} />
      {started && <div aria-hidden className="live-frame" />}

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-black tracking-tight">{ticket.name}</h1>
          <p className="text-xs text-muted">
            {ticket.role ?? "No job assigned"} · {started ? "live" : "standing by"}{note ? ` · ${note}` : ""}
          </p>
          {soundNote && <p className="mt-1 text-xs text-armed" role="status">{soundNote}</p>}
        </div>
        <div className="flex items-center gap-2">
          {/* A collaborator holds the show password, which is the host's own key: they can call it on. */}
          {ticket.host && (started
            ? <Button size="sm" variant="flat" color="danger" onPress={() => { bus.send({ type: "end" }); setStarted(null); }}>End</Button>
            : <Button size="sm" color="primary" onPress={() => { const at = new Date().toISOString(); bus.send({ type: "start", at }); setStarted(at); startCurtain(); }}>Start the show</Button>)}
          {started
            ? <span className="flex items-center gap-1 text-xs text-live"><Lock size={13} />Locked in</span>
            : <span className="flex items-center gap-1 text-xs text-muted"><Unlock size={13} />Not started</span>}
          <DarkToggle />
          <Button isIconOnly size="sm" variant="light" aria-label="Full screen"
            onPress={() => void document.documentElement.requestFullscreen?.().catch(() => {})}><Maximize size={15} /></Button>
          {can(ticket, "fire") && (soundOn
            ? <span className="flex items-center gap-1 text-xs text-ready"><Volume2 size={13} aria-hidden />Sound on</span>
            : <Button size="sm" variant="flat" startContent={<VolumeX size={14} aria-hidden />} onPress={enableSound}>
                Turn sound on
              </Button>)}
          {!started && <Button size="sm" variant="light" onPress={() => { forgetTicket(); setTicket(null); }}>Leave</Button>}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        {can(ticket, "cues") && (
          /* Deliberately not `.glass`: this is the running deck during a live show. A bevel that
             splits colour and a highlight that follows the pointer over a list that is changing
             under stage light is the one place refraction costs more than it gives. */
          <section className="glass-soft min-h-0 overflow-auto p-3">
            <h2 className="mb-2 label-cap text-muted">Sequence</h2>
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
                          bus.send({ type: "relabel", id: cue.id, label, from: ticket.role ?? "crew", member: ticket.member });
                          setCues(cs => cs.map(c => (c.id === cue.id ? { ...c, label } : c)));
                        }
                      }}>{cue.label}</button>
                  ) : <span className="min-w-0 flex-1 truncate">{cue.label}</span>}
                  {can(ticket, "fire") && (
                    <Button size="sm" variant="flat" onPress={() => bus.send({ type: "fire", index: i, sequence: deckSequence, from: ticket.role ?? "crew", member: ticket.member })}>Go</Button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {can(ticket, "script") && (
          <section className="glass flex min-h-0 flex-col p-3">
            <h2 className="mb-2 label-cap text-muted">Script</h2>
            <div className="min-h-0 flex-1">
              <ScriptReader doc={marked} setDoc={setDoc} />
            </div>
          </section>
        )}

        {can(ticket, "stage") && (
          <section className="glass flex min-h-0 flex-col p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="label-cap text-muted">On the screen</h2>
              {stage?.kind === "video" && (
                <Button size="sm" variant="light" onPress={() => setHearStage(h => !h)}
                  aria-pressed={hearStage} title={hearStage ? "Mute the stage video on this device" : "Hear the stage video on this device"}>
                  {hearStage ? <><Volume2 size={13} aria-hidden /> Sound on</> : <><VolumeX size={13} aria-hidden /> Muted</>}
                </Button>
              )}
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-black/40">
              {!stage && <p className="text-sm text-muted">Nothing up.</p>}
              {stage && <Stage stage={{ ...stage, visual: { ...stage.visual, muted: !hearStage } }} className="h-full w-full" />}
            </div>
          </section>
        )}

        {!can(ticket, "cues") && !can(ticket, "script") && !can(ticket, "stage") && (
          <section className="glass flex items-center justify-center p-8 text-center text-sm text-muted lg:col-span-2">
            You are in. Your job does not need the cue list or the script, messages will still reach you.
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
