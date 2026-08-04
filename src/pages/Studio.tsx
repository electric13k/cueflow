import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Button, Card, CardBody, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Slider, Spinner, Switch, Tab, Tabs, Tooltip, useDisclosure } from "../ui";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Check, ChevronDown, ChevronUp, CircleHelp, Link2, Unlink, Download, ExternalLink, FastForward, Film, GripVertical, Image as ImageIcon, Keyboard, Layers, ListMusic, Monitor, Music, Pause, Pencil, Play, Plus, Presentation, RefreshCw, Repeat, Rewind, RotateCcw, Search, SlidersHorizontal, Trash2, TriangleAlert, Upload, Volume2 } from "lucide-react";
import Backdrop from "../components/Backdrop";
import MediaEditor from "../components/MediaEditor";
import SlideComposer from "../components/SlideComposer";
import ScriptReader, { AlertFlash } from "../components/ScriptReader";
import { loadScript, type ScriptDoc } from "../lib/script";
import Nav from "../components/Nav";
import Onboarding from "../components/Onboarding";
import Stage from "../components/Stage";
import WaveformEditor from "../components/WaveformEditor";
import { fetchMedia } from "../lib/api";
import { AudioEngine, makeReversedFile } from "../lib/audio";
import { listen, send, type Msg } from "../lib/bus";
import { moved, useDragList } from "../lib/dragList";
import { downloadAsset, embedUrl, kindFromFile, kindFromUrl, prettyName, resolveHit, searchArchive, searchCommons, searchOpenverse, uniqueTitle, type Hit, type Source } from "../lib/media";
import { deleteSequenceEverywhere, deleteTrackEverywhere, hydrateCloud, isDeleted, local, mergeInto, onAuth, persist, uploadTrack, type SyncState } from "../lib/store";
import { toast } from "../lib/toast";
import { cloneEffects, cueNumbers, defaultEffects, defaultVisual, isVisual, kindOf, Effects, Kind, Sequence, SequenceItem, Stage as StageState, Track, Visual } from "../types";

const format = (s = 0) => Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00";
type Ctl = { key: keyof Effects; label: string; min: number; max: number; step: number; unit?: string };
const controls: Ctl[] = [
  { key: "speed", label: "Speed", min: .5, max: 2, step: .05, unit: "x" }, { key: "volume", label: "Volume", min: 0, max: 1, step: .01 },
  { key: "gain", label: "Gain", min: .1, max: 2, step: .05, unit: "x" }, { key: "reverb", label: "Reverb", min: 0, max: 1, step: .05 },
  { key: "fadeIn", label: "Fade in", min: 0, max: 8, step: .25, unit: "s" }, { key: "fadeOut", label: "Fade out", min: 0, max: 8, step: .25, unit: "s" },
  { key: "distortion", label: "Distortion", min: 0, max: 1, step: .05 },
  // Tone, in dB either side of flat. Named for what they do to the sound, not for their frequencies.
  { key: "bass", label: "Bass", min: -12, max: 12, step: .5, unit: " dB" },
  { key: "mid", label: "Mids", min: -12, max: 12, step: .5, unit: " dB" },
  { key: "treble", label: "Treble", min: -12, max: 12, step: .5, unit: " dB" },
];
type Session = { selectedId: string; sequenceId: string; cueIndex: number; tab: string };
const patch = (arr: Track[], id: string, p: Partial<Track>) => arr.map(t => t.id === id ? { ...t, ...p } : t);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const kindIcon = { audio: Volume2, image: ImageIcon, video: Film, embed: Presentation };
const UPLOAD_ACCEPT = "audio/*,image/*,video/*";

// Configurable keybinds: arrows drive cues, WASD drives whatever is on the screen, other keys nudge
// live effects.
type Action = "nextCue" | "prevCue" | "playPause" | "nextVisual" | "prevVisual" | "zoomIn" | "zoomOut" | "volUp" | "volDown" | "speedUp" | "speedDown" | "reverbUp" | "reverbDown";
const keyActions: { id: Action; label: string; def: string }[] = [
  { id: "nextCue", label: "Next cue", def: "ArrowRight" }, { id: "prevCue", label: "Previous cue", def: "ArrowLeft" },
  { id: "playPause", label: "Play / pause", def: " " },
  { id: "nextVisual", label: "Next slide or video", def: "d" }, { id: "prevVisual", label: "Previous slide or video", def: "a" },
  { id: "zoomIn", label: "Zoom the stage in", def: "w" }, { id: "zoomOut", label: "Zoom the stage out", def: "s" },
  { id: "volUp", label: "Volume +", def: "ArrowUp" }, { id: "volDown", label: "Volume −", def: "ArrowDown" },
  { id: "speedUp", label: "Speed +", def: "]" }, { id: "speedDown", label: "Speed −", def: "[" },
  { id: "reverbUp", label: "Reverb +", def: "r" }, { id: "reverbDown", label: "Reverb −", def: "e" },
];
const defaultBinds = Object.fromEntries(keyActions.map(a => [a.id, a.def])) as Record<Action, string>;
const keyLabel = (k: string) => k === " " ? "Space" : ({ ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓" } as Record<string, string>)[k] ?? (k.length === 1 ? k.toUpperCase() : k);

export default function Studio() {
  const audio = useRef<HTMLAudioElement>(new Audio());
  const engine = useRef(new AudioEngine());
  const session = local.get<Session>("session", { selectedId: "", sequenceId: "", cueIndex: 0, tab: "library" });
  const [tracks, setTracks] = useState<Track[]>(() => local.get("tracks", []));
  const [sequences, setSequences] = useState<Sequence[]>(() => local.get("sequences", []));
  const [selectedId, setSelectedId] = useState<string>(session.selectedId || local.get<Track[]>("tracks", [])[0]?.id || "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]); // multi-select for editor + add-to-sequence
  const lastPick = useRef(-1); // anchor for shift-click range selection in the library
  const [loop, setLoop] = useState(false);
  const [loopSeq, setLoopSeq] = useState(false);
  const [binds, setBinds] = useState<Record<Action, string>>(() => ({ ...defaultBinds, ...local.get("keybinds", defaultBinds) }));
  const keybindsModal = useDisclosure();
  const guideModal = useDisclosure();
  const [sequenceId, setSequenceId] = useState<string>(session.sequenceId);
  const [cueIndex, setCueIndex] = useState(session.cueIndex);
  const [tab, setTab] = useState(session.tab);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editUrl, setEditUrl] = useState(""); // unsaved editor buffer, as a blob URL, takes over playback for the selected track
  const wasEditing = useRef(false);
  const [stage, setStage] = useState<StageState>(null); // what the audience window is showing
  const [armed, setArmed] = useState(false);            // deck is loaded and the arrows are hot
  const [scriptMode, setScriptMode] = useState<"off" | "split" | "popup" | "tab">("off");
  const [scriptDoc, setScriptDoc] = useState<ScriptDoc>(() => loadScript());
  const [flash, setFlash] = useState<"warn" | "hit" | null>(null);
  const [alertNote, setAlertNote] = useState("");
  const alertTimer = useRef(0);
  /** Flash the control screen and hold the words a moment longer than the flash itself. */
  const showAlert = (level: "warn" | "hit", message: string) => {
    setAlertNote(message);
    setFlash(level);
    clearTimeout(alertTimer.current);
    alertTimer.current = window.setTimeout(() => setFlash(null), level === "hit" ? 1600 : 1100);
    window.setTimeout(() => setAlertNote(n => (n === message ? "" : n)), 6000);
  };
  const renameModal = useDisclosure();
  const [draft, setDraft] = useState<{ kind: "track" | "sequence"; id: string; value: string }>({ kind: "track", id: "", value: "" });

  const selected = tracks.find(t => t.id === selectedId) ?? tracks[0];
  const selectedSequence = sequences.find(s => s.id === sequenceId);
  useEffect(() => { audio.current.loop = loop; }, [loop]);

  const [sync, setSync] = useState<SyncState>({ cloud: false, ok: true });
  const syncHint = (s: SyncState) =>
    !s.ok ? `Last save failed: ${s.reason}. Click to pull your account's copy.`
      : !s.cloud ? s.reason ?? "Saved on this device only."
        : s.skipped ? `Saved. ${s.skipped} cue${s.skipped > 1 ? "s" : ""} still point at sounds that are not in your account yet.`
          : "Saved to your account. Click to pull anything a second device added.";
  const lastSyncNote = useRef("");
  // A failed save used to be indistinguishable from a good one. Report it once per distinct reason,
  // so a broken sync is visible on the device it happens on instead of at the next show.
  useEffect(() => {
    void persist(tracks, sequences).then(state => {
      setSync(state);
      const note = state.ok ? "" : state.reason ?? "unknown error";
      if (note && note !== lastSyncNote.current) toast("Couldn't save to your account", note, "warn");
      lastSyncNote.current = note;
    });
  }, [tracks, sequences]);
  useEffect(() => { local.set("session", { selectedId, sequenceId, cueIndex, tab } satisfies Session); }, [selectedId, sequenceId, cueIndex, tab]);
  useEffect(() => { local.set("keybinds", binds); }, [binds]);
  const data = useRef({ tracks, sequences }); data.current = { tracks, sequences };
  const mergeCloud = () => hydrateCloud().then(cloud => {
    if (!cloud) return false;
    const merged = mergeInto(data.current.tracks, data.current.sequences, cloud);
    setTracks(merged.tracks); setSequences(merged.sequences);
    return true;
  });
  /** Manual pull, for when a second device has work this one has not seen yet. */
  const syncNow = () => mergeCloud().then(pulled => toast(
    pulled ? "Synced" : "Nothing to sync",
    pulled ? "Pulled everything saved to your account." : "Sign in to sync across devices.",
    pulled ? "success" : "warn",
  ));
  useEffect(() => { void mergeCloud(); }, []);
  // On sign-in: pull the account's saved data and push whatever is currently local up to it.
  useEffect(() => onAuth(email => { if (!email) return; void mergeCloud().then(() => persist(data.current.tracks, data.current.sequences)); }), []);
  useEffect(() => {
    const a = audio.current; a.crossOrigin = "anonymous";
    const tick = () => { setTime(a.currentTime); const fade = selected?.effects.fadeOut ?? 0; if (fade && Number.isFinite(a.duration) && a.duration - a.currentTime <= fade) a.volume = Math.max(0, selected!.effects.volume * (a.duration - a.currentTime) / fade); };
    const meta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const ended = () => setPlaying(false);
    a.addEventListener("timeupdate", tick); a.addEventListener("loadedmetadata", meta); a.addEventListener("durationchange", meta); a.addEventListener("ended", ended);
    return () => { a.removeEventListener("timeupdate", tick); a.removeEventListener("loadedmetadata", meta); a.removeEventListener("durationchange", meta); a.removeEventListener("ended", ended); };
  }, [selected]);

  // One place to run a bound key, whether it was pressed in this window or forwarded from the
  // audience one. Returns true if it matched something, so the caller can preventDefault.
  const runKey = (key: string) => {
    const action = (Object.keys(binds) as Action[]).find(a => binds[a] === key); if (!action) return false;
    if ((action === "nextCue" || action === "prevCue" || action === "nextVisual" || action === "prevVisual") && !selectedSequence) return false;
    if ((action === "zoomIn" || action === "zoomOut") && !stage) return false;
    if (["volUp", "volDown", "speedUp", "speedDown", "reverbUp", "reverbDown"].includes(action) && !selected) return false;
    switch (action) {
      case "nextCue": advance(1); break;
      case "prevCue": advance(-1); break;
      case "nextVisual": advanceVisual(1); break;
      case "prevVisual": advanceVisual(-1); break;
      case "zoomIn": zoomStage(.1); break;
      case "zoomOut": zoomStage(-.1); break;
      case "playPause": toggle(); break;
      case "volUp": nudge("volume", .05, 0, 1); break;
      case "volDown": nudge("volume", -.05, 0, 1); break;
      case "speedUp": nudge("speed", .05, .5, 2); break;
      case "speedDown": nudge("speed", -.05, .5, 2); break;
      case "reverbUp": nudge("reverb", .05, 0, 1); break;
      case "reverbDown": nudge("reverb", -.05, 0, 1); break;
    }
    return true;
  };
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      if (runKey(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  // The audience window is a separate document, so keys pressed while it has focus never reach this
  // one; it forwards them over the same-origin channel instead, and a window that reloads asks for
  // the current cue again with "hello". The channel is opened once: re-opening it per render drops
  // whatever arrives between close and open.
  const onBus = useRef<(msg: Msg) => void>(() => {});
  onBus.current = msg => {
    if (msg.type === "key") runKey(msg.key);
    if (msg.type === "hello") send({ type: "stage", stage });
    if (msg.type === "script") setScriptDoc(loadScript());
    // A cue word coming up in a reader in another window still has to reach the operator here.
    if (msg.type === "alert") showAlert(msg.level, msg.message);
  };
  useEffect(() => listen(msg => onBus.current(msg)), []);
  // Whatever the operator sees on the stage, the room sees too.
  useEffect(() => { send({ type: "stage", stage }); }, [stage]);

  const updateEffects = (fx: Effects) => { if (!selected) return; setTracks(all => patch(all, selected.id, { effects: fx })); engine.current.apply(audio.current, fx); };
  const updateVisual = (visual: Visual) => { if (!selected) return; setTracks(all => patch(all, selected.id, { visual })); setStage(s => s && s.url === selected.url ? { ...s, visual } : s); };
  // A fresh edit invalidates whatever the element has loaded: swap the source and rewind rather than
  // let the transport keep playing the pre-edit audio.
  useEffect(() => {
    if (!editUrl && !wasEditing.current) return;
    wasEditing.current = !!editUrl;
    audio.current.pause(); setPlaying(false);
    audio.current.src = editUrl || selected?.url || "";
    audio.current.currentTime = 0; setTime(0); setDuration(0);
  }, [editUrl]);

  // restart=false resumes where it paused; the default fires the cue from the top, cutting off
  // whatever was still playing rather than queueing behind it.
  const play = async (track = selected, fx = selected?.effects, restart = true) => {
    if (!track || !fx) return;
    const a = audio.current;
    // The editor's unsaved buffer wins for its own track, so you hear the edit without saving first.
    const src = editUrl && track.id === selected?.id ? editUrl : track.url;
    const swap = a.src !== new URL(src, location.href).href;
    if (restart || swap) { a.pause(); setPlaying(false); }
    if (swap) { a.src = src; setDuration(0); }
    if (restart || swap) { a.currentTime = 0; setTime(0); }
    try { await engine.current.play(a, fx); setPlaying(true); } catch { setPlaying(false); }
  };
  const toggle = () => { if (playing) { audio.current.pause(); setPlaying(false); } else void play(selected, selected?.effects, false); };
  /** Puts a slide or video on the stage. Audio keeps playing under it, which is the whole point. */
  const show = (track: Track, visual = track.visual ?? defaultVisual()) =>
    setStage(s => ({ url: track.url, kind: kindOf(track), visual, label: track.title, n: (s?.n ?? 0) + 1 }));
  const zoomStage = (delta: number) => setStage(s => s && ({ ...s, visual: { ...s.visual, zoom: clamp(s.visual.zoom + delta, .25, 4) } }));
  // Soundboard: click a card to fire it (and make it the active/editor asset).
  const playTrack = (track: Track) => {
    setSelectedId(track.id);
    if (isVisual(track)) return show(track);
    if (track.id === selectedId && playing) { audio.current.pause(); setPlaying(false); return; }
    void play(track, track.effects);
  };
  // Shift-click picks a whole run in one go instead of one checkmark at a time. selectedIds stays
  // ordered, so a card can show the position it will take in the sequence.
  const toggleSelect = (id: string, index = -1, range = false) => setSelectedIds(ids => {
    if (range && lastPick.current >= 0 && index >= 0) {
      const [a, b] = [Math.min(lastPick.current, index), Math.max(lastPick.current, index)];
      lastPick.current = index;
      return [...ids, ...tracks.slice(a, b + 1).map(t => t.id).filter(x => !ids.includes(x))];
    }
    lastPick.current = index;
    return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
  });
  const jump = (s: number) => { audio.current.currentTime = Math.max(0, Math.min(audio.current.duration || 0, audio.current.currentTime + s)); };
  const seek = (v: number) => { audio.current.currentTime = v; setTime(v); };
  /** Sends one cue to the room. No index bookkeeping, so a linked partner can go out through it too. */
  const fire = (item: SequenceItem) => {
    const track = tracks.find(t => t.id === item.trackId);
    if (!track) return;
    if (isVisual(track)) show(track, item.visual ?? track.visual ?? defaultVisual());
    else void play(track, item.effects);
  };
  const playCue = (i: number) => {
    if (!selectedSequence) return;
    const item = selectedSequence.items[i]; if (!item) return;
    setCueIndex(i);
    fire(item);
    // A linked cue goes out with its partner: put up the slide, the sound under it starts, and the
    // deck's position stays on the cue that was actually called.
    const linked = item.link && selectedSequence.items.find(x => x.id === item.link);
    if (linked) fire(linked);
  };
  /** Both sides hold the link, and each cue has at most one partner, so an old pairing is dropped. */
  const linkCues = (aId: string, bId: string) => setSequences(all => all.map(s => s.id !== sequenceId ? s : ({
    ...s,
    items: s.items.map(it => {
      if (it.id === aId) return { ...it, link: bId };
      if (it.id === bId) return { ...it, link: aId };
      return it.link === aId || it.link === bId ? { ...it, link: undefined } : it;
    }),
  })));
  const unlinkCue = (id: string) => setSequences(all => all.map(s => s.id !== sequenceId ? s : ({
    ...s, items: s.items.map(it => (it.id === id || it.link === id ? { ...it, link: undefined } : it)),
  })));
  const advance = (dir: 1 | -1) => { if (!selectedSequence) return; const n = selectedSequence.items.length; if (!n) return; const i = loopSeq ? (cueIndex + dir + n) % n : clamp(cueIndex + dir, 0, n - 1); playCue(i); };
  /** WASD steps the deck's visuals only, so slides move without disturbing the sound already running. */
  const advanceVisual = (dir: 1 | -1) => {
    const items = selectedSequence?.items ?? []; if (!items.length) return;
    const visualAt = (i: number) => { const t = tracks.find(x => x.id === items[i]?.trackId); return t && isVisual(t); };
    for (let step = 1; step <= items.length; step++) {
      const i = loopSeq ? (cueIndex + dir * step + items.length * step) % items.length : cueIndex + dir * step;
      if (i < 0 || i >= items.length) break;
      if (visualAt(i)) return playCue(i);
    }
  };
  const nudge = (key: keyof Effects, delta: number, min: number, max: number) => { if (!selected) return; updateEffects({ ...selected.effects, [key]: clamp(Number(selected.effects[key]) + delta, min, max) }); };
  // Arms the deck without firing anything: cue 1 waits for the first arrow press, so nothing ever
  // hits the room the moment a window opens.
  const startSequence = (audience: boolean) => { if (!selectedSequence?.items.length) return; if (audience) openAudience(); setTab("sequence"); setCueIndex(-1); setStage(null); setArmed(true); audio.current.pause(); setPlaying(false); };
  // Stand down puts the room back to black and the studio back to a normal editing screen.
  const standDown = () => { setArmed(false); setCueIndex(0); setStage(null); audio.current.pause(); setPlaying(false); };

  // Optimistic: the asset appears instantly with a local object URL, then swaps to the cloud URL once uploaded.
  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])]; e.target.value = "";
    const files = picked.filter(f => kindFromFile(f)); if (!files.length) return;
    const taken = tracks.map(t => t.title);
    const created: Track[] = files.map(f => {
      const title = uniqueTitle(prettyName(f.name, "file"), taken); taken.push(title);
      const kind = kindFromFile(f)!;
      return { id: crypto.randomUUID(), title, url: URL.createObjectURL(f), kind, mime: f.type, effects: defaultEffects(), ...(kind === "audio" ? {} : { visual: defaultVisual() }), createdAt: new Date().toISOString(), pending: true };
    });
    setTracks(o => [...created, ...o]); setSelectedId(created[0].id);
    created.forEach((t, i) => uploadTrack(files[i])
      .then(url => { setTracks(o => patch(o, t.id, { url, pending: false })); URL.revokeObjectURL(t.url); })
      .catch(() => setTracks(o => patch(o, t.id, { pending: false, error: true }))));
  };
  /**
   * Import by URL. Everything goes through the serverless proxy: fetching remote media straight from
   * the page trips CORS on nearly every host, and an <audio crossOrigin="anonymous"> element then
   * refuses to load it at all. Slide-deck links (Google Slides, PowerPoint Online) are embedded
   * rather than downloaded, since there is no file to fetch.
   */
  const importAsset = (rawTitle: string, src: string) => {
    const title = uniqueTitle(rawTitle, tracks.map(t => t.title));
    const embed = embedUrl(src);
    const id = crypto.randomUUID();
    if (embed) {
      setTracks(o => [{ id, title, url: embed, kind: "embed", visual: defaultVisual(), effects: defaultEffects(), createdAt: new Date().toISOString() }, ...o]);
      setSelectedId(id);
      return;
    }
    const kind = kindFromUrl(src);
    setTracks(o => [{ id, title, url: src, kind, ...(kind === "audio" ? {} : { visual: defaultVisual() }), effects: defaultEffects(), createdAt: new Date().toISOString(), pending: true }, ...o]);
    setSelectedId(id);
    fetchMedia(src)
      .then(blob => uploadTrack(new File([blob], `${title}.${src.split(/[?#]/)[0].split(".").pop() || "mp3"}`, { type: blob.type || "audio/mpeg" })))
      .then(url => setTracks(o => patch(o, id, { url, pending: false })))
      .catch((e: Error) => {
        setTracks(o => o.filter(t => t.id !== id)); // a card that can never play is worse than none
        toast("Couldn't import that", e.message, "warn");
      });
  };
  const [slideOpen, setSlideOpen] = useState(false);
  const bakeReverse = async () => {
    if (!selected) return; setBusy(true);
    try { const file = await makeReversedFile(selected.url, selected.title); const url = await uploadTrack(file); setTracks(o => [{ id: crypto.randomUUID(), title: `${selected.title} (reversed)`, url, kind: "audio", effects: { ...selected.effects, reverse: false }, createdAt: new Date().toISOString() }, ...o]); }
    catch (err) { alert(`Reverse failed: ${(err as Error).message}`); } finally { setBusy(false); }
  };
  // Save an edited buffer or flattened image from an editor as a new cloud-backed asset.
  const addProcessedFile = async (file: File, title: string) => {
    const url = await uploadTrack(file);
    const kind = kindFromFile(file) ?? "audio";
    setTracks(o => [{ id: crypto.randomUUID(), title: uniqueTitle(title, o.map(t => t.title)), url, kind, ...(kind === "audio" ? {} : { visual: defaultVisual() }), effects: defaultEffects(), createdAt: new Date().toISOString() }, ...o]);
  };
  const deleteTrack = (id: string) => { const gone = tracks.find(t => t.id === id); void deleteTrackEverywhere(id, gone?.url ?? ""); setTracks(o => o.filter(t => t.id !== id)); setSequences(o => o.map(s => ({ ...s, items: s.items.filter(i => i.trackId !== id) }))); if (selectedId === id) setSelectedId(tracks.find(t => t.id !== id)?.id ?? ""); };

  const addSequence = () => { const seq: Sequence = { id: crypto.randomUUID(), name: `Sequence ${sequences.length + 1}`, items: [], createdAt: new Date().toISOString() }; setSequences(o => [...o, seq]); setSequenceId(seq.id); setCueIndex(0); };
  const deleteSequence = (id: string) => { void deleteSequenceEverywhere(id); setSequences(o => o.filter(s => s.id !== id)); if (sequenceId === id) setSequenceId(sequences.find(s => s.id !== id)?.id ?? ""); };
  const addItem = () => {
    if (!sequenceId) return;
    const chosen = (selectedIds.length ? selectedIds.map(id => tracks.find(t => t.id === id)) : [selected]).filter(Boolean) as Track[];
    if (!chosen.length) return;
    setSequences(o => o.map(s => s.id !== sequenceId ? s : { ...s, items: [...s.items, ...chosen.map(t => ({ id: crypto.randomUUID(), trackId: t.id, label: t.title, effects: cloneEffects(t.effects), ...(isVisual(t) ? { visual: { ...(t.visual ?? defaultVisual()) } } : {}) }))] }));
  };
  const deleteItem = (itemId: string) => setSequences(o => o.map(s => s.id !== sequenceId ? s : { ...s, items: s.items.filter(i => i.id !== itemId) }));
  const moveItem = (i: number, dir: -1 | 1) => reorder(i, i + dir);
  const reorder = (from: number, to: number) => setSequences(o => o.map(s => {
    if (s.id !== sequenceId || to < 0 || to >= s.items.length || from === to) return s;
    const items = [...s.items]; items.splice(to, 0, ...items.splice(from, 1));
    return { ...s, items };
  }));
  const setItemTransition = (itemId: string, transition: Visual["transition"]) => setSequences(o => o.map(s => s.id !== sequenceId ? s : {
    ...s, items: s.items.map(i => i.id !== itemId ? i : { ...i, visual: { ...(i.visual ?? defaultVisual()), transition } }),
  }));

  const openRename = (kind: "track" | "sequence", id: string, value: string) => { setDraft({ kind, id, value }); renameModal.onOpen(); };
  const commitRename = () => { const { kind, id, value } = draft; const v = value.trim(); if (!v) return; if (kind === "track") setTracks(o => patch(o, id, { title: v })); else setSequences(o => o.map(s => s.id === id ? { ...s, name: v } : s)); };
  const openAudience = () => window.open(`${location.origin}${import.meta.env.BASE_URL}audience`, "cueflow-audience", "popup,width=1000,height=650");
  // Split, popup or its own tab: the same reader either way, so where it lives is only a preference.
  const openScript = (where: "off" | "split" | "popup" | "tab") => {
    setScriptMode(where);
    if (where === "off" || where === "split") return;
    const url = `${location.origin}${import.meta.env.BASE_URL}script`;
    window.open(url, "cueflow-script", where === "popup" ? "popup,width=560,height=820" : "");
  };

  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Nav />
      <AlertFlash level={flash} />
      {/* The alert's own words, held on screen after the flash has gone: a flash you half-caught
          while looking at the deck is no use if it does not say what it was for. */}
      {alertNote && (
        <div className={`fixed inset-x-0 top-16 z-50 mx-auto w-fit rounded-full border px-4 py-1.5 text-sm font-semibold shadow-glass ${flash === "hit" ? "border-live/50 bg-live/20" : "border-armed/50 bg-armed/20"}`}>
          {alertNote}
        </div>
      )}
      {/* Bottom padding clears the fixed player, which stacks taller on phones. */}
      <div className="mx-auto max-w-7xl px-4 py-6 pb-60 sm:px-6 sm:pb-44 lg:px-8">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-[.3em] ${armed ? "text-armed" : "text-accent"}`}>{armed ? (cueIndex < 0 ? "Armed" : "Running") : "Studio"}</p>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{armed ? (selectedSequence?.name ?? "Cue board") : "Cue board"}</h1>
          </div>
          {/* Labels collapse to icons on phones, three full-width buttons do not fit a 375px row. */}
          <div className="flex flex-wrap gap-2">
            {/* A native select: three modes, one control, and it opens as a proper picker on a phone. */}
            <label className="flex items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 text-sm">
              <BookOpen size={16} className="text-muted" aria-hidden />
              <span className="sr-only">Script reader</span>
              <select value={scriptMode} onChange={e => openScript(e.target.value as typeof scriptMode)}
                className="bg-transparent py-2 pr-1 text-sm outline-none">
                <option value="off">Script: off</option>
                <option value="split">Split screen</option>
                <option value="popup">Popup</option>
                <option value="tab">New tab</option>
              </select>
            </label>
            {armed ? (
              <Button variant="bordered" onPress={standDown}>Stand down</Button>
            ) : (<>
              <Tooltip content="Replay the first-time setup guide" placement="bottom"><Button variant="flat" isIconOnly={false} startContent={<CircleHelp size={17} />} onPress={guideModal.onOpen}><span className="hidden sm:inline">Setup guide</span></Button></Tooltip>
              <Tooltip content="Set the keys for cues, slides and effects" placement="bottom"><Button variant="flat" startContent={<Keyboard size={17} />} onPress={keybindsModal.onOpen}><span className="hidden sm:inline">Keybinds</span></Button></Tooltip>
              <Tooltip content={syncHint(sync)} placement="bottom">
                <Button variant="flat" color={sync.ok ? "default" : "danger"} startContent={<RefreshCw size={17} />} onPress={syncNow}>
                  <span className="hidden sm:inline">{sync.ok ? "Sync" : "Not synced"}</span>
                </Button>
              </Tooltip>
              {/* Sequences has its own "Arm in audience mode", so this would be a second door to the same room. */}
              {tab !== "sequence" && <Tooltip content="Opens the presenter window, drag it to the mirrored display" placement="bottom"><Button color="primary" variant="flat" startContent={<Monitor size={17} />} onPress={openAudience}><span className="hidden sm:inline">Audience display</span></Button></Tooltip>}
            </>)}
          </div>
        </motion.div>

        {/* Armed: an amber frame round the window, red once cues are running. No sound, ever. */}
        {armed && <div aria-hidden className={`armed-frame ${cueIndex >= 0 ? "live-frame" : ""}`} />}
        {armed && (
          <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${cueIndex < 0 ? "border-armed/40 bg-armed/10" : "border-live/40 bg-live/10"}`}>
            <span className={`armed-dot h-2.5 w-2.5 rounded-full ${cueIndex < 0 ? "bg-armed" : "bg-live"}`} />
            <span className="text-sm font-semibold">
              {cueIndex < 0 ? "Deck armed. Nothing has gone out yet." : `Cue ${cueIndex + 1} of ${selectedSequence?.items.length ?? 0} is out.`}
            </span>
            <span className="text-xs text-muted">Press → for the next cue, ← to go back.</span>
            <span className="ml-auto"><Button size="sm" variant="flat" startContent={<Monitor size={15} />} onPress={openAudience}>Audience display</Button></span>
          </div>
        )}

        <div className={scriptMode === "split" ? "mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,30rem)]" : "mt-6"}>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 }} className="min-w-0">
          {/* Armed, the library and the editor go away: the deck is the only thing that matters and
              nothing on this screen should invite a stray click during a show. */}
          <Tabs selectedKey={tab} onSelectionChange={setTab} classNames={{ tabList: armed ? "hidden" : "glass-soft" }}>
            <Tab key="library" id="library" title={<span className="flex items-center gap-2"><Layers size={16} />Library</span>}>
              <Library tracks={tracks} selectedId={selected?.id ?? ""} playingId={playing ? selected?.id ?? "" : ""} selectedIds={selectedIds} busy={busy} onPlay={playTrack} onToggleSelect={toggleSelect} onClearSelection={() => setSelectedIds([])} onAdd={addFiles} onAddSlide={() => setSlideOpen(true)} onDelete={deleteTrack} onRename={(id: string) => { const t = tracks.find(x => x.id === id); if (t) openRename("track", id, t.title); }} importAsset={importAsset} onAddToSequence={addItem} hasSequence={!!sequenceId} />
            </Tab>
            <Tab key="editor" id="editor" title={<span className="flex items-center gap-2"><SlidersHorizontal size={16} />Editor</span>}>
              <Editor track={selected} busy={busy} update={updateEffects} updateVisual={updateVisual} bakeReverse={bakeReverse} onSave={addProcessedFile} onPreview={setEditUrl} onRename={() => selected && openRename("track", selected.id, selected.title)} />
            </Tab>
            <Tab key="sequence" id="sequence" title={<span className="flex items-center gap-2"><ListMusic size={16} />Sequences</span>}>
              <Sequences sequences={sequences} sequenceId={sequenceId} selectSequence={setSequenceId} addSequence={addSequence} deleteSequence={deleteSequence} renameSequence={(id: string) => { const s = sequences.find(x => x.id === id); if (s) openRename("sequence", id, s.name); }} tracks={tracks} selectedTrack={selected} selectedCount={selectedIds.length} addItem={addItem} deleteItem={deleteItem} moveItem={moveItem} reorder={reorder} setItemTransition={setItemTransition} linkCues={linkCues} unlinkCue={unlinkCue} playCue={playCue} cueIndex={cueIndex} loopSeq={loopSeq} setLoopSeq={setLoopSeq} startSequence={startSequence} stage={stage} clearStage={() => setStage(null)} />
            </Tab>
          </Tabs>
        </motion.div>
        {scriptMode === "split" && (
          <div className="h-[75vh] min-w-0 xl:sticky xl:top-4">
            {/* BroadcastChannel never echoes to the window that posted, so this one raises its own. */}
            <ScriptReader doc={scriptDoc} setDoc={setScriptDoc}
              onAlert={(level, message, cue) => { showAlert(level, message); send({ type: "alert", level, message, cue }); }} />
          </div>
        )}
        </div>
      </div>

      {/* Hidden in the editor: that tab has its own transport, and three play buttons on one screen
          is two too many. Visual assets have no transport at all. */}
      {/* A phone has no arrow keys. Armed, the deck gets a thumb-sized transport of its own. */}
      {armed && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex gap-3 border-t border-white/10 bg-background/90 p-3 backdrop-blur-xl lg:hidden">
          <Button className="h-14 flex-1 text-base" variant="flat" onPress={() => advance(-1)}>← Back</Button>
          <Button className="h-14 flex-[2] text-base" color="primary" onPress={() => advance(1)}>
            {cueIndex < 0 ? "Fire cue 1" : "Next cue →"}
          </Button>
        </div>
      )}

      <AnimatePresence>{selected && !isVisual(selected) && tab !== "editor" && !armed && <Player key="player" track={selected} unsaved={!!editUrl} playing={playing} toggle={toggle} time={time} duration={duration} seek={seek} jump={jump} loop={loop} setLoop={setLoop} effects={selected.effects} update={updateEffects} />}</AnimatePresence>

      <Modal isOpen={renameModal.isOpen} onOpenChange={renameModal.onOpenChange} placement="center" backdrop="blur">
        <ModalContent>{onClose => (<>
          <ModalHeader>Rename {draft.kind}</ModalHeader>
          <ModalBody><Input autoFocus label="Name" value={draft.value} onValueChange={v => setDraft(d => ({ ...d, value: v }))} onKeyDown={e => { if (e.key === "Enter") { commitRename(); onClose(); } }} /></ModalBody>
          <ModalFooter><Button variant="light" onPress={onClose}>Cancel</Button><Button color="primary" onPress={() => { commitRename(); onClose(); }}>Save</Button></ModalFooter>
        </>)}</ModalContent>
      </Modal>

      <SlideComposer open={slideOpen} onClose={() => setSlideOpen(false)} onCreate={addProcessedFile} />
      <Onboarding control={guideModal} />
      <KeybindsModal disc={keybindsModal} binds={binds} setBinds={setBinds} />
    </div>
  );
}

function Library({ tracks, selectedId, playingId, selectedIds, busy, onPlay, onToggleSelect, onClearSelection, onAdd, onAddSlide, onDelete, onRename, importAsset, onAddToSequence, hasSequence }: any) {
  const count = selectedIds.length;
  const [filter, setFilter] = useState("");
  const shown: Track[] = filter ? tracks.filter((t: Track) => t.title.toLowerCase().includes(filter.toLowerCase())) : tracks;
  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Soundboard and slides</p><h2 className="text-xl font-bold">Click a card to fire it</h2></div>
        <div className="flex flex-wrap gap-2">
          {count > 0 && <Button variant="light" size="sm" onPress={onClearSelection}>Clear {count}</Button>}
          <Tooltip content={hasSequence ? "Adds them in the order you picked them" : "Create a sequence first"}><span><Button variant="bordered" startContent={<Plus size={16} />} isDisabled={!hasSequence} onPress={onAddToSequence}>Add {count > 1 ? `${count} ` : ""}to sequence</Button></span></Tooltip>
          <Tooltip content="A blank 16:9 slide you can put a title on"><Button variant="bordered" isDisabled={busy} startContent={<Presentation size={16} />} onPress={onAddSlide}>New slide</Button></Tooltip>
          <Tooltip content="Audio, images and video from this device"><Button as="label" color="primary" startContent={<Upload size={17} />}>Upload<input hidden type="file" accept={UPLOAD_ACCEPT} multiple onChange={onAdd} /></Button></Tooltip>
        </div>
      </div>

      <SearchPanel importAsset={importAsset} filter={filter} setFilter={setFilter} />

      {shown.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid place-items-center rounded-2xl border border-dashed border-default-200 py-16 text-center">
          <Music size={40} className="text-muted" />
          <p className="mt-3 font-semibold">{tracks.length ? "Nothing matches that" : "Nothing here yet"}</p>
          <p className="text-sm text-muted">{tracks.length ? "Clear the search to see everything." : "Upload audio, images or video, or search the free libraries above."}</p>
        </motion.div>
      ) : (
        <motion.div layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>{shown.map((t: Track, i: number) => {
            const isPlaying = playingId === t.id, pick = selectedIds.indexOf(t.id), isChecked = pick >= 0;
            const kind = kindOf(t), Icon = kindIcon[kind];
            return (
            <motion.div key={t.id} layout initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} transition={{ delay: Math.min(i * .03, .3) }} whileHover={{ y: -3 }}>
              <Card isPressable onPress={() => onPlay(t)} className={`w-full overflow-hidden border ${isPlaying ? "border-accent bg-accent/15" : selectedId === t.id ? "border-accent/60 bg-accent/5" : "border-border bg-surface/60"} ${t.pending ? "opacity-70" : ""}`}>
                {kind === "image" && <img src={t.url} alt="" className="h-24 w-full object-cover" />}
                {kind === "video" && <video src={t.url} muted preload="metadata" className="h-24 w-full object-cover" />}
                <CardBody className="gap-2">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${isPlaying ? "bg-accent text-accent-foreground" : "bg-surface-secondary text-foreground"}`}>
                      {t.pending ? <Spinner size="sm" /> : kind !== "audio" ? <Icon size={15} /> : isPlaying ? <Pause fill="currentColor" size={15} /> : <Play fill="currentColor" size={15} />}
                    </span>
                    <p className="min-w-0 flex-1 truncate pt-1.5 font-semibold capitalize leading-tight">{t.title}</p>
                    <div className="flex shrink-0 gap-1">
                      <Tooltip content={isChecked ? `Cue ${pick + 1} of the selection, click to drop it` : "Select (shift-click to take a run)"}>
                        <Button isIconOnly size="sm" variant={isChecked ? "solid" : "light"} color={isChecked ? "primary" : "default"} onPress={(e: any) => onToggleSelect(t.id, i, !!e?.shiftKey)}>
                          {isChecked ? <span className="text-xs font-bold tabular-nums">{pick + 1}</span> : <Check size={14} />}
                        </Button>
                      </Tooltip>
                      <Tooltip content="Download"><Button isIconOnly size="sm" variant="light" isDisabled={kind === "embed"} onPress={() => void downloadAsset(t.url, t.title)}><Download size={14} /></Button></Tooltip>
                      <Tooltip content="Rename"><Button isIconOnly size="sm" variant="light" onPress={() => onRename(t.id)}><Pencil size={14} /></Button></Tooltip>
                      <Tooltip content="Delete everywhere"><Button isIconOnly size="sm" variant="light" color="danger" onPress={() => onDelete(t.id)}><Trash2 size={14} /></Button></Tooltip>
                    </div>
                  </div>
                  {t.error
                    ? <p className="flex items-center gap-1 text-xs text-warning"><TriangleAlert size={12} /> local only, cloud save failed</p>
                    : <p className="pl-10 text-xs capitalize text-muted">{kind === "audio" ? `${t.effects.speed}x • ${Math.round(t.effects.volume * 100)}% vol${t.effects.reverb ? " • reverb" : ""}` : `${kind} • ${t.visual?.transition ?? "fade"} in`}</p>}
                </CardBody>
              </Card>
            </motion.div>
          );})}</AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

const SOURCES: { id: Source; label: string }[] = [
  { id: "library", label: "My library" },
  { id: "archive", label: "Internet Archive" },
  { id: "commons", label: "Wikimedia Commons" },
  { id: "openverse", label: "Openverse (stock audio + images)" },
  { id: "myinstants", label: "Myinstants" },
  { id: "url", label: "Paste a link" },
];

function SearchPanel({ importAsset, filter, setFilter }: { importAsset: (title: string, url: string) => void; filter: string; setFilter: (v: string) => void }) {
  const [source, setSource] = useState<Source>("library");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const query = q.trim();
    setNote("");
    if (source === "library") return setFilter(query);
    if (!query) return;
    if (source === "myinstants") {
      // Myinstants sits behind Cloudflare, which blocks server-side search from datacenter IPs, so
      // search hands off to their own site rather than pretending to work.
      window.open(`https://www.myinstants.com/en/search/?name=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
      setNote("Opened Myinstants in a new tab. Right-click a sound there, copy its audio address, then paste it back here with “Paste a link”.");
      return;
    }
    if (source === "url") {
      if (/myinstants\.com\/(en\/)?instant\//.test(query)) return setNote("That's the page, not the sound. On Myinstants, right-click the sound button, copy the audio address, and paste that instead.");
      importAsset(prettyName(query), query);
      setQ("");
      return;
    }
    setLoading(true); setHits([]);
    const search = { archive: searchArchive, commons: searchCommons, openverse: searchOpenverse }[source as "archive" | "commons" | "openverse"] ?? searchCommons;
    try { setHits(await search(query)); }
    catch (e) { setNote((e as Error).message); }
    finally { setLoading(false); }
  };
  const take = async (hit: Hit) => {
    setNote("");
    try { importAsset(hit.title, await resolveHit(hit)); }
    catch (e) { setNote((e as Error).message); }
  };
  const placeholder = source === "library" ? "Filter your library" : source === "url" ? "Paste a direct media link (.mp3, .wav, .png, .mp4) or a Google Slides link" : source === "myinstants" ? "Search Myinstants (e.g. airhorn, vine boom)" : "Search freely licensed audio";

  return (
    <div className="glass-soft space-y-3 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><Search size={15} className="text-accent" /> Find media</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Where to search" value={source}
          onChange={e => { setSource(e.target.value as Source); setHits([]); setNote(""); if (e.target.value !== "library") setFilter(""); }}
          className="rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-accent">
          {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <Input className="min-w-56 flex-1" size="sm" value={q}
          onValueChange={(v: string) => { setQ(v); if (source === "library") setFilter(v); }}
          placeholder={placeholder} onKeyDown={(e: any) => e.key === "Enter" && void run()} />
        <Button size="sm" color="primary" variant="flat" isLoading={loading} endContent={source === "myinstants" ? <ExternalLink size={14} /> : undefined} onPress={() => void run()}>
          {source === "url" ? "Import" : "Search"}
        </Button>
      </div>
      {source === "library" && filter && <p className="text-xs text-muted">Filtering by “{filter}”. <button className="text-accent underline-offset-2 hover:underline" onClick={() => { setQ(""); setFilter(""); }}>Clear</button></p>}
      {(source === "archive" || source === "commons") && (
        <p className="text-xs text-muted">Public-domain and freely licensed recordings. Imports land in your library under a cleaned-up name; check the licence before you perform anything publicly.</p>
      )}
      {source === "url" && <p className="text-xs text-muted">Direct file links only. A Google Slides or PowerPoint Online link is added as an embedded deck instead of a download.</p>}
      {hits.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-auto border-t border-border pt-3">
          {hits.map(h => (
            <li key={h.id}>
              <button className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/5" onClick={() => void take(h)}>
                <Plus size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-sm">{h.title}</span>
                {h.by && <span className="shrink-0 truncate text-xs text-muted">{h.by}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-xs text-warning">{note}</p>}
    </div>
  );
}

function Editor({ track, busy, update, updateVisual, bakeReverse, onSave, onPreview, onRename }: any) {
  if (!track) return <div className="mt-5 rounded-2xl border border-dashed border-default-200 py-16 text-center text-muted">Select something in the Library to edit it.</div>;
  const kind = kindOf(track);
  const heading = (
    <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Non-destructive editor</p>
      <h2 className="flex items-center gap-2 text-xl font-bold capitalize">{track.title}<Button isIconOnly size="sm" variant="light" onPress={onRename}><Pencil size={15} /></Button></h2></div>
  );
  if (kind !== "audio") return (
    <div className="mt-5 space-y-6">
      {heading}
      <p className="max-w-2xl text-sm text-muted">
        {kind === "embed"
          ? "An embedded deck. Edit the slides in Google Slides or PowerPoint itself; the transition and caption below are what CueFloww adds when the cue fires."
          : "Framing, colour and timing ride with this asset and are applied when the cue fires, so the original file is never touched. Flatten to a new image if you want a copy with the look baked in."}
      </p>
      <MediaEditor track={track} onChange={updateVisual} onSave={onSave} />
    </div>
  );
  return (
    <div className="mt-5 space-y-6">
      {heading}
      <p className="max-w-2xl text-sm text-muted">Effects save with this sound and apply live in playback and sequences. The waveform tools render new cloud-backed WAVs, clip a region, mix to mono, or balance the left/right channels.</p>
      <WaveformEditor track={track} onSave={onSave} onPreview={onPreview} />
      <EffectGrid effects={track.effects} update={update} />
      <div className="glass-soft flex flex-wrap items-center gap-4 p-4">
        <Switch isSelected={track.effects.reverse} onValueChange={(v: boolean) => update({ ...track.effects, reverse: v })}>Mark for reverse render</Switch>
        {track.effects.reverse && <Button color="primary" variant="flat" startContent={busy ? <Spinner size="sm" color="current" /> : <RotateCcw size={16} />} isDisabled={busy} onPress={bakeReverse}>Render & save reversed</Button>}
        <Button variant="light" startContent={<Download size={16} />} onPress={() => void downloadAsset(track.url, track.title)}>Download</Button>
      </div>
    </div>
  );
}

function Sequences({ sequences, sequenceId, selectSequence, addSequence, deleteSequence, renameSequence, tracks, selectedTrack, selectedCount, addItem, deleteItem, moveItem, reorder, setItemTransition, linkCues, unlinkCue, playCue, cueIndex, loopSeq, setLoopSeq, startSequence, stage, clearStage }: any) {
  // Which cue is waiting to be paired. Linking is two clicks, so the second one has to know.
  const [linking, setLinking] = useState("");
  const seq = sequences.find((s: Sequence) => s.id === sequenceId);
  const cueDrag = useDragList(reorder);
  // Rendered order is the drag preview while a drag is in flight, and the real order otherwise.
  const order: SequenceItem[] = !seq ? [] : cueDrag.drag ? moved(seq.items, cueDrag.drag.from, cueDrag.drag.to) : seq.items;
  const numbers = cueNumbers(order.map(item => {
    const track = tracks.find((t: Track) => t.id === item.trackId);
    return track ? kindOf(track) : "audio";
  }));
  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Manual cue deck</p><h2 className="text-xl font-bold">Sequences</h2></div>
        <Button color="primary" startContent={<Plus size={16} />} onPress={addSequence}>New sequence</Button>
      </div>
      {sequences.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sequences.map((s: Sequence) => (
            <div key={s.id} className={`flex items-center gap-1 rounded-full border px-1 pl-3 ${s.id === sequenceId ? "border-accent bg-accent/15" : "border-border bg-surface/50"}`}>
              <button className="py-1.5 text-sm font-semibold" onClick={() => selectSequence(s.id)}>{s.name}</button>
              <Button isIconOnly size="sm" variant="light" onPress={() => renameSequence(s.id)}><Pencil size={13} /></Button>
              <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => deleteSequence(s.id)}><Trash2 size={13} /></Button>
            </div>
          ))}
        </div>
      )}
      {!seq ? (
        <div className="rounded-2xl border border-dashed border-default-200 py-16 text-center text-muted">Create a sequence, then add sounds and slides from the Library. It never autoplays, drive it with the ← → arrow keys or click a cue.</div>
      ) : (
        <div className="space-y-3">
          <div className="glass-soft flex flex-wrap items-center gap-3 p-3">
            <Tooltip content="Arms the deck. Nothing plays until you press →"><Button size="sm" color="primary" startContent={<Play size={14} fill="currentColor" />} isDisabled={!seq.items.length} onPress={() => startSequence(false)}>Arm</Button></Tooltip>
            <Tooltip content="Opens the presenter window and arms the deck"><Button size="sm" color="secondary" variant="flat" startContent={<Monitor size={14} />} isDisabled={!seq.items.length} onPress={() => startSequence(true)}>Arm in audience mode</Button></Tooltip>
            <Switch size="sm" isSelected={loopSeq} onValueChange={setLoopSeq}>Loop sequence</Switch>
            <span className="ml-auto text-xs text-muted">{cueIndex < 0 ? "Armed. Press → to fire cue 1" : "← → step every cue, A / D step slides only, W / S zoom"}</span>
          </div>

          {/* What the audience window is showing. Also the whole preview when no window is open. */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="order-2 space-y-3 lg:order-1">
              <div className="flex items-center gap-2 text-sm text-muted">
                <span>{selectedCount > 1 ? <>Adds <b className="text-foreground">{selectedCount} selected items</b>.</> : <>Adds the selected item{selectedTrack ? <> (<b className="text-foreground">{selectedTrack.title}</b>)</> : ""}.</>}</span>
                <Button size="sm" variant="flat" color="primary" startContent={<Plus size={14} />} isDisabled={!selectedTrack && !selectedCount} onPress={addItem}>Add {selectedCount > 1 ? `${selectedCount} cues` : "cue"}</Button>
              </div>
              {seq.items.length === 0 ? <p className="rounded-2xl border border-dashed border-default-200 py-10 text-center text-muted">Empty sequence. Add the selected item above.</p> : (
                <ol className="space-y-2" ref={cueDrag.list}>
                  <AnimatePresence>{order.map((item: SequenceItem, i: number) => {
                    const track = tracks.find((t: Track) => t.id === item.trackId);
                    const kind: Kind = track ? kindOf(track) : "audio";
                    const Icon = kindIcon[kind];
                    const held = cueDrag.drag?.to === i;
                    return (
                    // Layout animation is off mid-drag: an animating row reports a moving rectangle,
                    // and the drop target is computed from those rectangles.
                    <motion.li key={item.id} layout={!cueDrag.dragging} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                      <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${held ? "border-accent bg-accent/15 shadow-lg" : i === cueIndex ? "border-accent bg-accent/10" : "border-border bg-surface/50"}`}>
                        {/* The grip is the drag surface, and it is finger-sized: -m-2 p-2 gives it a
                            40px target without changing the row's layout. */}
                        <span
                          role="button" tabIndex={-1} aria-label={`Reorder ${item.label}`}
                          className="-m-2 shrink-0 cursor-grab touch-none p-2 text-muted active:cursor-grabbing"
                          onPointerDown={cueDrag.start(i)} onPointerMove={cueDrag.move}
                          onPointerUp={cueDrag.end} onPointerCancel={cueDrag.end}
                        >
                          <GripVertical size={15} aria-hidden />
                        </span>
                        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => playCue(i)}>
                          <span className={`w-6 shrink-0 rounded-md text-center font-mono text-sm font-bold ${kind === "audio" ? "bg-audio/15 text-audio" : "bg-visual/15 text-visual"}`}>{numbers[i]}</span>
                          <Icon size={14} className="shrink-0 text-muted" aria-hidden />
                          <span className="truncate font-medium capitalize">{item.label}</span>
                          {item.link && <span className="shrink-0 rounded-md bg-visual/15 px-1.5 font-mono text-[11px] font-bold text-visual" title="Fires together with this cue">+{numbers[order.findIndex((x: SequenceItem) => x.id === item.link)] ?? "?"}</span>}
                          <span className="ml-auto hidden shrink-0 text-xs text-muted sm:inline">{track?.title ?? "missing"}</span>
                        </button>
                        {kind !== "audio" && (
                          <select aria-label="Transition" value={item.visual?.transition ?? "fade"} onChange={e => setItemTransition(item.id, e.target.value)}
                            className="shrink-0 rounded-lg border border-border bg-surface/60 px-2 py-1 text-xs capitalize outline-none focus:border-accent">
                            {["cut", "fade", "slide", "zoom"].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        )}
                        <div className="flex shrink-0">
                          {/* Two clicks: chain this cue, then click the one it goes with. */}
                          {linking && linking !== item.id ? (
                            <Button size="sm" variant="flat" color="primary" onPress={() => { linkCues(linking, item.id); setLinking(""); }}>Link here</Button>
                          ) : (
                            <Tooltip content={item.link ? `Linked to cue ${numbers[order.findIndex((x: SequenceItem) => x.id === item.link)] ?? "?"} — click to unlink` : linking === item.id ? "Now click the cue this goes with" : "Fire this cue together with another"}>
                              <Button isIconOnly size="sm" variant={item.link || linking === item.id ? "solid" : "light"} color={item.link ? "secondary" : linking === item.id ? "primary" : "default"}
                                onPress={() => { if (item.link) { unlinkCue(item.id); setLinking(""); } else setLinking(l => (l === item.id ? "" : item.id)); }}>
                                {item.link ? <Unlink size={14} /> : <Link2 size={15} />}
                              </Button>
                            </Tooltip>
                          )}
                          <Tooltip content="Move up"><Button isIconOnly size="sm" variant="light" isDisabled={i === 0} onPress={() => moveItem(i, -1)}><ChevronUp size={15} /></Button></Tooltip>
                          <Tooltip content="Move down"><Button isIconOnly size="sm" variant="light" isDisabled={i === seq.items.length - 1} onPress={() => moveItem(i, 1)}><ChevronDown size={15} /></Button></Tooltip>
                          <Tooltip content="Remove cue"><Button isIconOnly size="sm" variant="light" color="danger" onPress={() => deleteItem(item.id)}><Trash2 size={14} /></Button></Tooltip>
                        </div>
                      </div>
                    </motion.li>
                  );})}</AnimatePresence>
                </ol>
              )}
            </div>
            <div className="order-1 space-y-2 lg:order-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">Stage</p>
                {stage && <Button size="sm" variant="light" onPress={clearStage}>Blackout</Button>}
              </div>
              <Stage stage={stage} className="aspect-video w-full rounded-xl border border-border" />
              <p className="text-xs text-muted">{stage ? stage.label : "Black. Audio-only cues leave the room dark."}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EffectGrid({ effects, update }: { effects: Effects; update: (fx: Effects) => void }) {
  // Tracks saved before the tone controls existed have no bass/mid/treble, and Number(undefined) is
  // NaN, which a slider renders as an empty thumb. Fall back to the defaults for anything missing.
  const base = defaultEffects();
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      {controls.map(c => (
        <Slider key={c.key} size="sm" color="primary" label={c.label} minValue={c.min} maxValue={c.max} step={c.step}
          value={Number(effects[c.key] ?? base[c.key])} onChange={v => update({ ...effects, [c.key]: Array.isArray(v) ? v[0] : v })}
          getValue={v => `${Number(v).toFixed(c.step < .1 ? 2 : 1)}${c.unit ?? ""}`} />
      ))}
    </div>
  );
}

// Centred with inset + auto margins rather than -translate-x-1/2: framer-motion writes its own
// inline `transform` for the entry animation, which silently wins over a Tailwind translate.
function Player({ track, unsaved, playing, toggle, time, duration, seek, jump, loop, setLoop, effects, update }: any) {
  const [open, setOpen] = useState(false);
  const speed = Number(effects.speed) || 1;
  return (
    <motion.section initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="glass fixed inset-x-2 bottom-4 z-20 mx-auto max-w-[1080px] p-3 sm:inset-x-4 sm:p-4">
      {/* Phones get the title above the transport; there is no room for both on one line. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-bold capitalize">
            {track.title}
            {unsaved && <span className="shrink-0 rounded-full border border-secondary/40 bg-secondary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary">Unsaved edit</span>}
          </p>
          {/* playbackRate never touches element.duration, so at 2x a 30s file still reports 30s.
              Divide by speed to show how long it will actually take. */}
          <p className="text-xs text-muted">
            {format(time / speed)} / {format(duration / speed)}
            {speed !== 1 && <span className="ml-1 text-accent">{speed}x</span>}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 sm:gap-4">
          <Tooltip content="Back 5s"><Button isIconOnly variant="flat" radius="full" onPress={() => jump(-5)}><Rewind size={18} /></Button></Tooltip>
          <Button isIconOnly color="primary" radius="full" size="lg" onPress={toggle} className="shadow-lg shadow-accent/30">{playing ? <Pause fill="currentColor" size={22} /> : <Play fill="currentColor" size={22} />}</Button>
          <Tooltip content="Forward 5s"><Button isIconOnly variant="flat" radius="full" onPress={() => jump(5)}><FastForward size={18} /></Button></Tooltip>
          <Tooltip content={loop ? "Looping" : "Loop"}><Button isIconOnly variant={loop ? "solid" : "flat"} color={loop ? "primary" : "default"} radius="full" onPress={() => setLoop((l: boolean) => !l)}><Repeat size={18} /></Button></Tooltip>
          <Tooltip content="Live effects"><Button isIconOnly variant={open ? "solid" : "flat"} color={open ? "primary" : "default"} radius="full" onPress={() => setOpen(o => !o)}><SlidersHorizontal size={18} /></Button></Tooltip>
        </div>
      </div>
      <Slider aria-label="Progress" size="sm" color="primary" className="mt-2" minValue={0} maxValue={duration || 0.0001} step={0.1} value={Math.min(time, duration || 0)} onChange={v => seek(Array.isArray(v) ? v[0] : v)} />
      <AnimatePresence>{open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="mt-3 grid gap-x-6 gap-y-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
            {controls.slice(0, 4).map(c => (
              <Slider key={c.key} size="sm" color="primary" label={c.label} minValue={c.min} maxValue={c.max} step={c.step}
                value={Number(effects[c.key])} onChange={v => update({ ...effects, [c.key]: Array.isArray(v) ? v[0] : v })}
                getValue={v => `${Number(v).toFixed(c.step < .1 ? 2 : 1)}${c.unit ?? ""}`} />
            ))}
          </div>
        </motion.div>
      )}</AnimatePresence>
    </motion.section>
  );
}

function KeybindRow({ label, value, onSet }: { label: string; value: string; onSet: (k: string) => void }) {
  const [listening, setListening] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2">
      <span className="text-sm">{label}</span>
      <button
        className={`min-w-24 rounded-lg border px-3 py-1.5 font-mono text-sm ${listening ? "border-accent bg-accent/15 text-accent" : "border-white/15 bg-white/5"}`}
        onClick={() => setListening(true)} onBlur={() => setListening(false)}
        onKeyDown={e => { if (!listening) return; e.preventDefault(); if (e.key === "Escape") return setListening(false); onSet(e.key); setListening(false); }}
      >{listening ? "Press a key…" : keyLabel(value)}</button>
    </div>
  );
}

function KeybindsModal({ disc, binds, setBinds }: { disc: ReturnType<typeof useDisclosure>; binds: Record<Action, string>; setBinds: (u: (b: Record<Action, string>) => Record<Action, string>) => void }) {
  return (
    <Modal isOpen={disc.isOpen} onOpenChange={disc.onOpenChange} placement="center" backdrop="blur" scrollBehavior="inside">
      <ModalContent>{onClose => (<>
        <ModalHeader className="flex items-center gap-2"><Keyboard size={18} className="text-accent" />Keybinds</ModalHeader>
        <ModalBody className="gap-2">
          <p className="text-xs text-muted">Click a key box, then press a key to bind it. Arrows step every cue; WASD drives whatever is on the stage, so slides move without touching the sound underneath.</p>
          {keyActions.map(a => <KeybindRow key={a.id} label={a.label} value={binds[a.id]} onSet={k => setBinds(b => ({ ...b, [a.id]: k }))} />)}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => setBinds(() => defaultBinds)}>Reset defaults</Button>
          <Button color="primary" onPress={onClose}>Done</Button>
        </ModalFooter>
      </>)}</ModalContent>
    </Modal>
  );
}
