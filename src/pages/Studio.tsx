import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Button, Card, CardBody, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Slider, Spinner, Switch, Tab, Tabs, Tooltip, useDisclosure } from "../ui";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, ChevronDown, ChevronUp, FileText, Link2, Unlink, Download, ExternalLink, FastForward, Film, GripVertical, Image as ImageIcon, Layers, ListMusic, Monitor, Pause, Pencil, Play, Plus, Presentation, Radio, Repeat, Rewind, RotateCcw, Search, SlidersHorizontal, Trash2, TriangleAlert, Upload, Volume2, Undo2, Redo2, Star, FolderPlus, Clock3, History, NotebookPen, Command, FileJson, Copy } from "lucide-react";
import { useIsPhone } from "../lib/layout";
import LogoMark from "../components/LogoMark";
import MediaEditor from "../components/MediaEditor";
import SlideComposer from "../components/SlideComposer";
import ScriptReader, { AlertFlash } from "../components/ScriptReader";
import { loadScript, type ScriptDoc } from "../lib/script";
import { teach } from "../lib/coach";
import { CoachHelp } from "../components/Coach";
import { loadBinds, type Action } from "../lib/keys";
import Shell from "../components/Shell";
import SearchBar from "../components/SearchBar";
import ShowsBoard from "../components/ShowsBoard";
import ShowManager from "../components/ShowManager";
import DarkToggle, { WorkSurface } from "../components/DarkToggle";
import { useSignedIn } from "../components/RequireAuth";
import { currentProject } from "../lib/projects";
import { createShow, deleteShow, listShows, SCRIPT_LIMIT, showChannel, updateShow, type Show, type ShowMsg } from "../lib/shows";
import { loadLinks, saveLinks, withScript, withSequence, withoutShow, type LinkMap } from "../lib/showLinks";
import Stage from "../components/Stage";
import WaveformEditor from "../components/WaveformEditor";
import { fetchMedia } from "../lib/api";
import { AudioEngine, makeReversedFile } from "../lib/audio";
import { listen, send, type Msg } from "../lib/bus";
import { moved, useDragList } from "../lib/dragList";
import CommandPalette, { type PaletteCommand } from "../components/CommandPalette";
import { addToCollection, buildProjectExport, formatTimer, loadFeatures, makeTemplate, readProjectExport, recordHistory, redoSequences, removeFromCollections, saveDownload, saveFeatures, setCollection, toggleFavorite, undoSequences, type FeatureState } from "../lib/features";
// Aliased: `SearchPanel` already has a local `search` for the media-source lookup.
import { search as rank, type Facet, type SortKey } from "../lib/search";
import { cuePoints } from "../lib/trim";
import { downloadAsset, embedUrl, kindFromFile, kindFromUrl, prettyName, resolveHit, searchArchive, searchCommons, searchOpenverse, uniqueTitle, type Hit, type Source } from "../lib/media";
import { deleteSequenceEverywhere, deleteTrackEverywhere, hydrateCloud, isDeleted, local, mergeInto, onAuth, persist, uploadTrack } from "../lib/store";
import { toast } from "../lib/toast";
import { cloneEffects, cueNumbers, defaultEffects, defaultVisual, isVisual, kindOf, Effects, Kind, Sequence, SequenceItem, Stage as StageState, Track, Visual } from "../types";

const format = (s = 0) => Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00";
const timerLeftFor = (id: string, timers: Record<string, number>) => Number(timers[id] ?? 0);
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
/**
 * Which project this device is working in, read once. Switching reloads the page rather than
 * swapping the state in place: the selection, the open deck, the cue index and what is on the stage
 * all belong to the project that was open, and carrying any of them across is a bug, not a feature.
 */
const project = currentProject();
const key = (k: string) => (project ? `${k}:${project}` : k);
const patch = (arr: Track[], id: string, p: Partial<Track>) => arr.map(t => t.id === id ? { ...t, ...p } : t);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const kindIcon = { audio: Volume2, image: ImageIcon, video: Film, embed: Presentation };
const UPLOAD_ACCEPT = "audio/*,image/*,video/*";

/**
 * The four things the Studio is, in the order they are used: you gather media, you put it in an
 * order, you run it as a show, and you read from the script while it goes. On a phone these are
 * destinations rather than sections of one long page.
 */
const PANES = [
  { id: "library", label: "Library", icon: Layers },
  { id: "deck", label: "Deck", icon: ListMusic },
  { id: "shows", label: "Shows", icon: Radio },
  { id: "script", label: "Script", icon: FileText },
] as const;
type PaneId = (typeof PANES)[number]["id"];

export default function Studio() {
  const audio = useRef<HTMLAudioElement>(new Audio());
  const engine = useRef(new AudioEngine());
  // Arriving from the workspace: ?tab=editor&track=<id> opens that sound in the editor, so "edit
  // this" is one click from where you saw it rather than a hunt through the library.
  const link = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const stored = local.get<Session>(key("session"), { selectedId: "", sequenceId: "", cueIndex: 0, tab: "library" });
  const session: Session = {
    ...stored,
    tab: link.get("tab") ?? stored.tab,
    selectedId: link.get("track") ?? stored.selectedId,
    sequenceId: link.get("seq") ?? stored.sequenceId,
  };
  const [tracks, setTracks] = useState<Track[]>(() => local.get(key("tracks"), []));
  const [sequences, setSequences] = useState<Sequence[]>(() => local.get(key("sequences"), []));
  const [selectedId, setSelectedId] = useState<string>(session.selectedId || local.get<Track[]>(key("tracks"), [])[0]?.id || "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]); // multi-select for editor + add-to-sequence
  const lastPick = useRef(-1); // anchor for shift-click range selection in the library
  const [loop, setLoop] = useState(false);
  const [loopSeq, setLoopSeq] = useState(false);
  // Read once. The keys are bound on the Settings page now; this screen only fires them.
  const [binds] = useState<Record<Action, string>>(loadBinds);
  const [sequenceId, setSequenceId] = useState<string>(session.sequenceId);
  const [cueIndex, setCueIndex] = useState(session.cueIndex);
  // Two tabs, and the editor is not one of them: an item opens into it. A saved session or a
  // ?tab=editor link from the workspace therefore opens the item rather than selecting a tab.
  const [tab, setTab] = useState(session.tab === "editor" ? "library" : session.tab);
  // Which of the four panes a phone is showing. Ignored entirely above 640px, where all four are on
  // screen together and the question does not arise.
  const phone = useIsPhone();
  const [pane, setPane] = useState<PaneId>("library");
  const [editingId, setEditingId] = useState(session.tab === "editor" ? session.selectedId : "");
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
  const historyModal = useDisclosure();
  const [draft, setDraft] = useState<{ kind: "track" | "sequence"; id: string; value: string }>({ kind: "track", id: "", value: "" });

  // The show: one performance across every device in the room. The channel lives here rather than in
  // the host panel because the things worth broadcasting -- a cue going out, the stage changing --
  // happen out here, and a panel that is closed must not stop them reaching anyone.
  const [liveShow, setLiveShow] = useState<Show | null>(null);
  // The manager is a screen, not a dialog, so it is a flag rather than a disclosure. Closing it
  // leaves `liveShow` alone on purpose: the channel outlives the panel, or a host who shut the
  // manager would stop hearing the room.
  const [managing, setManaging] = useState(false);
  const showBus = useRef<{ send: (m: ShowMsg) => void; close: () => void } | null>(null);
  const onShowMsg = useRef<(m: ShowMsg) => void>(() => {});
  // The shows section above the tabs. Shows are an account feature, so signed out there is none.
  const signedIn = useSignedIn();
  const [shows, setShows] = useState<Show[]>([]);
  const [links, setLinks] = useState<LinkMap>(() => loadLinks(project));
  /**
   * Whether the shows section is a grid or still the one button, persisted rather than derived.
   * A load that answers with nothing -- offline, or before the request lands -- is not the same
   * event as the last show being deleted, and only the second of those is allowed to put the button
   * back. Derived from `shows.length` it would flicker back to a button on every reload.
   */
  const [showsGrid, setShowsGrid] = useState(() => local.get(key("grid:shows"), false));
  const [features, setFeatures] = useState<FeatureState>(() => loadFeatures(project));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [timerLeft, setTimerLeft] = useState(0);
  const featureRef = useRef(features); featureRef.current = features;
  const sequenceRef = useRef(sequences); sequenceRef.current = sequences;
  const gridOn = (v: boolean) => { setShowsGrid(v); local.set(key("grid:shows"), v); };
  const updateFeatures = (updater: (state: FeatureState) => FeatureState) => {
    const next = updater(featureRef.current);
    featureRef.current = next;
    setFeatures(next);
    saveFeatures(project, next);
  };
  const applySequences = (updater: (all: Sequence[]) => Sequence[], label: string) => {
    const before = sequenceRef.current;
    const after = updater(before);
    sequenceRef.current = after;
    setSequences(after);
    updateFeatures(state => recordHistory(state, before, after, label));
  };
  /** The script half of the board obeys the same rule; its one card is the whole grid. */
  const [scriptGrid, setScriptGrid] = useState(() => local.get(key("grid:script"), false));
  useEffect(() => {
    const has = !!scriptDoc.html;
    setScriptGrid(was => { if (was !== has) local.set(key("grid:script"), has); return has; });
  }, [scriptDoc.html]);
  useEffect(() => onAuth(email => {
    if (!email) return setShows([]);
    void listShows(project).then(list => { setShows(list); if (list.length) gridOn(true); }).catch(() => setShows([]));
  }), []);
  const relink = (next: LinkMap) => { setLinks(next); saveLinks(project, next); };

  const addShow = (name: string) => void createShow(name, project, sequenceId || null)
    .then(made => { setShows(o => [made, ...o]); gridOn(true); teach("show"); })
    .catch(e => toast("Could not make that show", (e as Error).message, "warn"));
  const removeShow = (show: Show) => {
    if (!confirm(`Delete "${show.name}"? The sequences and the script it carries stay where they are.`)) return;
    void deleteShow(show.id).then(() => {
      setShows(o => { const left = o.filter(x => x.id !== show.id); if (!left.length) gridOn(false); return left; });
      relink(withoutShow(links, show.id));
      if (liveShow?.id === show.id) setLiveShow(null);
    }).catch(e => toast("Could not delete that show", (e as Error).message, "warn"));
  };
  const openShow = (show: Show) => { teach("show"); setLiveShow(show); setManaging(true); };
  /** Dropped, not opened: the first sequence becomes the show's deck, the rest ride along with it. */
  const sequenceToShow = (seqId: string, showId: string) => {
    relink(withSequence(links, showId, seqId));
    const show = shows.find(s => s.id === showId);
    if (show && !show.sequenceId) {
      setShows(o => o.map(s => (s.id === showId ? { ...s, sequenceId: seqId } : s)));
      void updateShow(showId, { sequence_id: seqId }).catch(e => toast("Saved here only", (e as Error).message, "warn"));
    }
    toast("Added to the show", `${sequences.find(s => s.id === seqId)?.name ?? "That sequence"} goes out with ${show?.name ?? "the show"}.`, "success");
  };

  /**
   * Library and sequence search live out here rather than inside the panels that render them,
   * because a drag carries an index and the index has to mean the same row the grid is showing.
   */
  const [libQuery, setLibQuery] = useState("");
  const [libSort, setLibSort] = useState<SortKey>("importance");
  const [libKind, setLibKind] = useState<string[]>([]);
  const [libScope, setLibScope] = useState("");
  const trackFacet: Facet<Track> = t => ({ text: [t.title], kind: kindOf(t), createdAt: t.createdAt });
  const scopedTracks = libScope === "favorites" ? tracks.filter(t => features.favorites.includes(t.id)) : libScope ? tracks.filter(t => (features.collections[libScope] ?? []).includes(t.id)) : tracks;
  const shownTracks = rank(scopedTracks, trackFacet, { query: libQuery, filter: { kind: libKind }, sort: libSort });
  const [seqQuery, setSeqQuery] = useState("");
  const [seqSort, setSeqSort] = useState<SortKey>("importance");
  const seqFacet: Facet<Sequence> = s => ({ text: [s.name, ...s.items.map(i => i.label)], kind: "sequence", createdAt: s.createdAt });
  const shownSequences = rank(sequences, seqFacet, { query: seqQuery, sort: seqSort });

  const undo = () => {
    const result = undoSequences(featureRef.current, sequenceRef.current);
    if (!result) return toast("Nothing to undo", "The sequence history is already at its beginning.", "info");
    sequenceRef.current = result.sequences; setSequences(result.sequences); updateFeatures(() => result.state); toast("Undid last sequence edit", "You can redo it from the same toolbar.", "success");
  };
  const redo = () => {
    const result = redoSequences(featureRef.current, sequenceRef.current);
    if (!result) return toast("Nothing to redo", "The sequence history is already at its latest edit.", "info");
    sequenceRef.current = result.sequences; setSequences(result.sequences); updateFeatures(() => result.state); toast("Redid sequence edit", "The sequence is back at its later version.", "success");
  };
  const duplicateSequence = (source: Sequence) => {
    const duplicate: Sequence = { ...source, id: crypto.randomUUID(), name: `${source.name} copy`, createdAt: new Date().toISOString(), items: source.items.map(item => ({ ...item, id: crypto.randomUUID(), link: undefined })) };
    applySequences(all => [...all, duplicate], "Duplicate sequence"); setSequenceId(duplicate.id); setTab("sequence"); toast("Sequence duplicated", duplicate.name, "success");
  };
  const saveCurrentTemplate = () => {
    if (!selectedSequence) return toast("Choose a sequence first", "Templates are made from the selected sequence.", "warn");
    const name = prompt("Template name", `${selectedSequence.name} template`)?.trim();
    if (!name) return;
    updateFeatures(state => ({ ...state, templates: [...state.templates, makeTemplate(name, selectedSequence)] }));
    toast("Template saved", name, "success");
  };
  const createFromTemplate = (templateId: string) => {
    const template = features.templates.find(item => item.id === templateId);
    if (!template) return;
    const created: Sequence = { ...template.sequence, id: crypto.randomUUID(), name: `${template.name} ${sequences.length + 1}`, createdAt: new Date().toISOString(), items: template.sequence.items.map(item => ({ ...item, id: crypto.randomUUID(), link: undefined })) };
    applySequences(all => [...all, created], "Create sequence from template"); setSequenceId(created.id); setTab("sequence"); toast("Sequence created from template", created.name, "success");
  };
  const exportProject = () => saveDownload(buildProjectExport(project, tracks, sequences, featureRef.current), `cueflow-project-${new Date().toISOString().slice(0, 10)}.json`);
  const importProject = async (file: File) => {
    try {
      const incoming = await readProjectExport(file);
      if (!confirm(`Replace this project with ${incoming.tracks.length} library items and ${incoming.sequences.length} sequences?`)) return;
      setTracks(incoming.tracks); sequenceRef.current = incoming.sequences; setSequences(incoming.sequences); setSelectedId(incoming.tracks[0]?.id ?? ""); setSequenceId(incoming.sequences[0]?.id ?? ""); updateFeatures(() => incoming.features); toast("Project imported", "Your Cueflow project is ready on this device.", "success");
    } catch (error) { toast("Could not import project", (error as Error).message, "warn"); }
  };
  const newCollection = () => { const name = prompt("Collection name", "Act One"); if (!name?.trim()) return; updateFeatures(state => setCollection(state, name, [])); setLibScope(name.trim()); };
  const addToNamedCollection = (trackId: string) => { const name = prompt("Add to collection", Object.keys(features.collections)[0] ?? "Act One"); if (!name?.trim()) return; updateFeatures(state => addToCollection(state, name, trackId)); toast("Added to collection", name.trim(), "success"); };
  const setCueTimer = (itemId: string, seconds: number) => updateFeatures(state => ({ ...state, cueTimers: { ...state.cueTimers, [itemId]: Math.max(0, Math.min(3600, Math.round(seconds))) } }));
  const toggleRehearsal = () => updateFeatures(state => ({ ...state, rehearsal: { ...state.rehearsal, active: !state.rehearsal.active, sequenceId: sequenceId || state.rehearsal.sequenceId, completed: state.rehearsal.active ? state.rehearsal.completed : [] } }));
  const markRehearsed = (itemId: string) => updateFeatures(state => ({ ...state, rehearsal: { ...state.rehearsal, completed: state.rehearsal.completed.includes(itemId) ? state.rehearsal.completed : [...state.rehearsal.completed, itemId] } }));
  const saveRehearsalNote = (itemId: string, note: string) => updateFeatures(state => ({ ...state, rehearsal: { ...state.rehearsal, notes: { ...state.rehearsal.notes, [itemId]: note } } }));
  const clearRunHistory = () => updateFeatures(state => ({ ...state, runHistory: [] }));
  const importFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importProject(file); };
  const scriptToShow = (showId: string) => {
    relink(withScript(links, showId));
    toast("Added to the show", `The script goes out with ${shows.find(s => s.id === showId)?.name ?? "the show"}.`, "success");
  };
  useEffect(() => {
    if (!liveShow) return;
    const channel = showChannel(liveShow.id, m => onShowMsg.current(m));
    showBus.current = channel;
    return () => { channel.close(); showBus.current = null; };
  }, [liveShow?.id]);
  // Starting and ending are the two moments every device has to hear about, and the stage changing
  // is the only other thing a device might be mirroring. Both resend rather than diff: a deck is
  // small, and a device that missed one message would otherwise stay wrong all night.
  useEffect(() => { if (liveShow) showBus.current?.send(liveShow.startedAt ? { type: "start", at: liveShow.startedAt } : { type: "end" }); }, [liveShow?.startedAt]);
  useEffect(() => { if (liveShow) showBus.current?.send(deck()); }, [stage?.n, liveShow?.id]);

  const selected = tracks.find(t => t.id === selectedId) ?? tracks[0];
  const selectedSequence = sequences.find(s => s.id === sequenceId);
  useEffect(() => { audio.current.loop = loop; }, [loop]);

  const lastSyncNote = useRef("");
  // Sync is on and has no button: it runs on every change and only speaks up when it fails, once
  // per distinct reason, so a broken save is visible on the device it happens on rather than at the
  // next show.
  useEffect(() => {
    // Wait for the typing to stop. Dragging a cue fires this on every frame, and a save per frame is
    // both wasted work and the thing that used to make two of them overlap.
    const timer = setTimeout(() => {
      void persist(tracks, sequences, project).then(state => {
        const note = state.ok ? "" : state.reason ?? "unknown error";
        if (note && note !== lastSyncNote.current) toast("Couldn't save to your account", note, "warn");
        lastSyncNote.current = note;
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [tracks, sequences]);
  useEffect(() => { local.set(key("session"), { selectedId, sequenceId, cueIndex, tab } satisfies Session); }, [selectedId, sequenceId, cueIndex, tab]);
  const data = useRef({ tracks, sequences }); data.current = { tracks, sequences };
  const mergeCloud = () => hydrateCloud(project).then(cloud => {
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
  useEffect(() => onAuth(email => { if (!email) return; void mergeCloud().then(() => persist(data.current.tracks, data.current.sequences, project)); }), []);
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
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
    if (featureRef.current.rehearsal.active) markRehearsed(item.id);
    updateFeatures(state => ({ ...state, runHistory: [...state.runHistory, { id: crypto.randomUUID(), at: new Date().toISOString(), type: "cue" as const, sequenceId: selectedSequence.id, sequenceName: selectedSequence.name, cueIndex: i, label: cueLabels[i] ?? String(i + 1) }].slice(-500) }));
    showBus.current?.send({ type: "cue", index: i, label: cueLabels[i] ?? String(i + 1) });
  };

  /**
   * What the room is allowed to know: the sequence as labels, and the script. No source URLs
   * for sounds, because a device that only reads cues has no business being able to download them.
   */
  const cueLabels = selectedSequence ? cueNumbers(selectedSequence.items.map(it => kindOf(tracks.find(t => t.id === it.trackId) ?? { kind: "audio" }))) : [];
  const deck = (): ShowMsg => ({
    type: "deck",
    show: selectedSequence?.name ?? "Show",
    index: cueIndex,
    cues: (selectedSequence?.items ?? []).map((it, i) => ({
      id: it.id, label: it.label, number: cueLabels[i] ?? String(i + 1),
      kind: kindOf(tracks.find(t => t.id === it.trackId) ?? { kind: "audio" }),
    })),
    script: scriptDoc.html.length > SCRIPT_LIMIT ? undefined : scriptDoc.html,
    stage: stage ? { url: stage.url, kind: stage.kind, label: stage.label } : null,
  });
  onShowMsg.current = msg => {
    if (msg.type === "here") { showBus.current?.send(deck()); toast("Someone joined", `${msg.role ?? "A device"} is in the show.`, "info"); }
    if (msg.type === "fire") playCue(msg.index);
    if (msg.type === "flash") showAlert("warn", msg.text);
    // A collaborator holds the show password, so calling the show on is theirs to do as well. The
    // host's copy is still the one that gets written down.
    if (msg.type === "start" && liveShow) { setLiveShow({ ...liveShow, startedAt: msg.at }); void updateShow(liveShow.id, { started_at: msg.at }); }
    if (msg.type === "end" && liveShow) { setLiveShow({ ...liveShow, startedAt: null }); void updateShow(liveShow.id, { started_at: null }); }
    if (msg.type === "relabel") setSequences(all => all.map(s => s.id !== sequenceId ? s : ({
      ...s, items: s.items.map(it => (it.id === msg.id ? { ...it, label: msg.label } : it)),
    })));
  };
  /** Both sides hold the link, and each cue has at most one partner, so an old pairing is dropped. */
  const linkCues = (aId: string, bId: string) => applySequences(all => all.map(s => s.id !== sequenceId ? s : ({
    ...s,
    items: s.items.map(it => {
      if (it.id === aId) return { ...it, link: bId };
      if (it.id === bId) return { ...it, link: aId };
      return it.link === aId || it.link === bId ? { ...it, link: undefined } : it;
    }),
  })), "Link cues");
  const unlinkCue = (id: string) => applySequences(all => all.map(s => s.id !== sequenceId ? s : ({
    ...s, items: s.items.map(it => (it.id === id || it.link === id ? { ...it, link: undefined } : it)),
  })), "Unlink cues");
  const advance = (dir: 1 | -1) => { if (!selectedSequence) return; const n = selectedSequence.items.length; if (!n) return; const i = loopSeq ? (cueIndex + dir + n) % n : clamp(cueIndex + dir, 0, n - 1); playCue(i); };
  useEffect(() => {
    if (!armed || !selectedSequence || cueIndex < 0) { setTimerLeft(0); return; }
    const item = selectedSequence.items[cueIndex];
    const seconds = Number(item ? featureRef.current.cueTimers[item.id] ?? 0 : 0);
    if (!seconds || (!loopSeq && cueIndex >= selectedSequence.items.length - 1)) { setTimerLeft(0); return; }
    const started = Date.now();
    const tick = () => {
      const left = seconds - (Date.now() - started) / 1000;
      setTimerLeft(Math.max(0, left));
      if (left <= 0) { clearInterval(id); advance(1); }
    };
    const id = window.setInterval(tick, 100);
    tick();
    return () => clearInterval(id);
  }, [armed, cueIndex, loopSeq, selectedSequence?.id, selectedSequence?.items.length, features.cueTimers]);
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
  // A phone has no arrow keys, so the armed lesson would be teaching a control that is not there:
  // narrow screens get the docked transport explained instead. One lesson per arming, either way.
  // `seq` defaults to the open one, and is passed when a sequence is run straight from the rail or
  // from the show manager: one sequence on its own, in a show or outside one, is the same arming.
  const startSequence = (audience: boolean, seq = selectedSequence) => {
    teach(matchMedia("(max-width: 1023px)").matches ? "transport" : "armed");
    if (!seq?.items.length) return;
    setSequenceId(seq.id);
    if (audience) openAudience();
    setTab("sequence"); setCueIndex(-1); setStage(null); setArmed(true); audio.current.pause(); setPlaying(false);
    updateFeatures(state => ({ ...state, runHistory: [...state.runHistory, { id: crypto.randomUUID(), at: new Date().toISOString(), type: "start" as const, sequenceId: seq.id, sequenceName: seq.name }].slice(-500) }));
  };
  /** From the manager: leave the show's screen, arm that sequence, put it up in presenter mode. */
  const runSequence = (seqId: string) => { setManaging(false); startSequence(true, sequences.find(s => s.id === seqId)); };
  // Stand down puts the room back to black and the studio back to a normal editing screen.
  const standDown = () => { setArmed(false); setCueIndex(0); setStage(null); audio.current.pause(); setPlaying(false); updateFeatures(state => ({ ...state, runHistory: [...state.runHistory, { id: crypto.randomUUID(), at: new Date().toISOString(), type: "end" as const, sequenceId: sequenceId, sequenceName: selectedSequence?.name }].slice(-500) })); };

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
  const deleteTrack = (id: string) => { const gone = tracks.find(t => t.id === id); void deleteTrackEverywhere(id, gone?.url ?? ""); setTracks(o => o.filter(t => t.id !== id)); applySequences(o => o.map(s => ({ ...s, items: s.items.filter(i => i.trackId !== id) })), "Remove library item from sequences"); updateFeatures(state => removeFromCollections(state, id)); if (selectedId === id) setSelectedId(tracks.find(t => t.id !== id)?.id ?? ""); };

  const addSequence = () => { const seq: Sequence = { id: crypto.randomUUID(), name: `Sequence ${sequences.length + 1}`, items: [], createdAt: new Date().toISOString() }; applySequences(o => [...o, seq], "Create sequence"); setSequenceId(seq.id); setCueIndex(0); };
  const deleteSequence = (id: string) => { void deleteSequenceEverywhere(id); applySequences(o => o.filter(s => s.id !== id), "Delete sequence"); if (sequenceId === id) setSequenceId(sequences.find(s => s.id !== id)?.id ?? ""); };
  /** One way in for all three: the toolbar's picker, the Add button, and a card dropped on a chip. */
  const addTracksTo = (seqId: string, ids: string[]) => {
    const chosen = ids.map(id => tracks.find(t => t.id === id)).filter(Boolean) as Track[];
    if (!seqId || !chosen.length) return;
    applySequences(o => o.map(s => s.id !== seqId ? s : { ...s, items: [...s.items, ...chosen.map(t => ({ id: crypto.randomUUID(), trackId: t.id, label: t.title, effects: cloneEffects(t.effects), ...(isVisual(t) ? { visual: { ...(t.visual ?? defaultVisual()) } } : {}) }))] }), "Add cue to sequence");
    toast("Added to the sequence", `${chosen.length} item${chosen.length === 1 ? "" : "s"} into ${sequences.find(s => s.id === seqId)?.name ?? "it"}.`, "success");
  };
  const addItem = () => addTracksTo(sequenceId, selectedIds.length ? selectedIds : selected ? [selected.id] : []);
  const openEditor = (id: string) => { setSelectedId(id); setEditingId(id); teach("editor"); };
  /**
   * The three drags §10 asks for, all on one screen and all through `useDragList`: a sequence chip
   * onto a show, a library card onto a sequence chip, and the script onto a show (that last one is
   * the board's own, since the script card lives there).
   */
  const seqDrag = useDragList(() => {}, (i, target) => {
    if (target.startsWith("show:")) sequenceToShow(shownSequences[i].id, target.slice(5));
  });
  const libDrag = useDragList(() => {}, (i, target) => {
    if (target.startsWith("seq:")) addTracksTo(target.slice(4), [shownTracks[i].id]);
  });
  /** A deleted track can still be in `selectedIds`, and a toolbar counting ghosts is a lying toolbar. */
  const picked = selectedIds.filter(id => tracks.some(t => t.id === id));
  const deleteItem = (itemId: string) => applySequences(o => o.map(s => s.id !== sequenceId ? s : { ...s, items: s.items.filter(i => i.id !== itemId) }), "Remove cue");
  const moveItem = (i: number, dir: -1 | 1) => reorder(i, i + dir);
  const reorder = (from: number, to: number) => applySequences(o => o.map(s => {
    if (s.id !== sequenceId || to < 0 || to >= s.items.length || from === to) return s;
    const items = [...s.items]; items.splice(to, 0, ...items.splice(from, 1));
    return { ...s, items };
  }), "Reorder cues");
  const setItemTransition = (itemId: string, transition: Visual["transition"]) => applySequences(o => o.map(s => s.id !== sequenceId ? s : {
    ...s, items: s.items.map(i => i.id !== itemId ? i : { ...i, visual: { ...(i.visual ?? defaultVisual()), transition } }),
  }), "Change cue transition");

  const openRename = (kind: "track" | "sequence", id: string, value: string) => { setDraft({ kind, id, value }); renameModal.onOpen(); };
  const commitRename = () => { const { kind, id, value } = draft; const v = value.trim(); if (!v) return; if (kind === "track") setTracks(o => patch(o, id, { title: v })); else applySequences(o => o.map(s => s.id === id ? { ...s, name: v } : s), "Rename sequence"); };
  const openAudience = () => { teach("presenter"); window.open(`${location.origin}${import.meta.env.BASE_URL}audience`, "cueflow-audience", "popup,width=1000,height=650"); };
  // Split, popup or its own tab: the same reader either way, so where it lives is only a preference.
  const openScript = (where: "off" | "split" | "popup" | "tab") => {
    setScriptMode(where);
    if (where !== "off") teach("script");
    if (where === "off" || where === "split") return;
    const url = `${location.origin}${import.meta.env.BASE_URL}script`;
    window.open(url, "cueflow-script", where === "popup" ? "popup,width=560,height=820" : "");
  };

  const commands: PaletteCommand[] = [
    { id: "undo", label: "Undo sequence edit", hint: "Ctrl+Z", group: "Editing", disabled: !features.undo.length, run: undo },
    { id: "redo", label: "Redo sequence edit", hint: "Ctrl+Shift+Z", group: "Editing", disabled: !features.redo.length, run: redo },
    { id: "new-sequence", label: "Create a new sequence", group: "Sequences", run: addSequence },
    { id: "duplicate", label: "Duplicate selected sequence", group: "Sequences", disabled: !selectedSequence, run: () => selectedSequence && duplicateSequence(selectedSequence) },
    { id: "template", label: "Save selected sequence as template", group: "Sequences", disabled: !selectedSequence, run: saveCurrentTemplate },
    { id: "rehearsal", label: features.rehearsal.active ? "End rehearsal mode" : "Start rehearsal mode", group: "Show control", run: toggleRehearsal },
    { id: "export", label: "Export project backup", group: "Project", run: exportProject },
    { id: "history", label: "Open run history", group: "Show control", run: historyModal.onOpen },
  ];

  return (
    <Shell>
      {/* The working surface, and the only thing the dark toggle reaches: the sidebar, the nav and
          the footer around it stay beige, and so does everybody else's device. */}
      <WorkSurface className="-mx-3 rounded-2xl px-3 py-4">
      <AlertFlash level={flash} />
      {/* The alert's own words, held on screen after the flash has gone: a flash you half-caught
          while looking at the deck is no use if it does not say what it was for. */}
      {alertNote && (
        <div className={`fixed inset-x-0 top-16 z-50 mx-auto w-fit rounded-full border px-4 py-1.5 text-sm font-semibold shadow-glass ${flash === "hit" ? "border-live/50 bg-live/20" : "border-armed/50 bg-armed/20"}`}>
          {alertNote}
        </div>
      )}
      {/* Bottom padding clears the fixed player, which stacks taller on phones, and on a phone the
          pane bar below it as well. */}
      <div className="pb-72 sm:pb-36">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-[.3em] ${armed ? "text-armed" : "text-accent"}`}>{armed ? (cueIndex < 0 ? "Armed" : "Running") : "Studio"}</p>
            <h1 className="flex items-center gap-1 text-2xl font-black tracking-tight sm:text-3xl">
              {armed ? (selectedSequence?.name ?? "Cue board") : "Cue board"}
              <CoachHelp id="studio" />
            </h1>
          </div>
          {/* Everything that used to sit here went where it belongs: the shows and the script to the
              board below, the project switch to the sidebar, the keybinds to Settings, the sync to
              itself, and the audience display to the Sequences tab's "Arm in audience mode". */}
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            {armed && <Button variant="bordered" onPress={standDown}>Stand down</Button>}
            <Tooltip content="Command palette (Ctrl+K)"><Button isIconOnly size="sm" variant="light" aria-label="Open command palette" onPress={() => setPaletteOpen(true)}><Command size={16} /></Button></Tooltip>
            <Tooltip content="Undo"><Button isIconOnly size="sm" variant="light" aria-label="Undo sequence edit" isDisabled={!features.undo.length} onPress={undo}><Undo2 size={16} /></Button></Tooltip>
            <Tooltip content="Redo"><Button isIconOnly size="sm" variant="light" aria-label="Redo sequence edit" isDisabled={!features.redo.length} onPress={redo}><Redo2 size={16} /></Button></Tooltip>
            <Tooltip content="Run history"><Button isIconOnly size="sm" variant="light" aria-label="Open run history" onPress={historyModal.onOpen}><History size={16} /></Button></Tooltip>
            <Button size="sm" variant="light" startContent={<FileJson size={15} />} onPress={exportProject}>Export</Button>
            <Button size="sm" variant="light" startContent={<Upload size={15} />} as="label">Import<input hidden type="file" accept="application/json,.json" onChange={importFile} /></Button>
            {/* Dark is a property of this desk, not of the app and not of the show: it darkens the
                surface below and nothing on anybody else's device. */}
            <DarkToggle />
          </span>
        </motion.div>

        {/* Armed: an amber frame round the window, red once cues are running. No sound, ever. */}
        {armed && <div aria-hidden className={`armed-frame ${cueIndex >= 0 ? "live-frame" : ""}`} />}
        {armed && (
          <div data-tour="armed-banner" className={`mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${cueIndex < 0 ? "border-armed/40 bg-armed/10" : "border-live/40 bg-live/10"}`}>
            <span className={`armed-dot h-2.5 w-2.5 rounded-full ${cueIndex < 0 ? "bg-armed" : "bg-live"}`} />
            <span className="text-sm font-semibold">
              {cueIndex < 0 ? "Deck armed. Nothing has gone out yet." : `Cue ${cueIndex + 1} of ${selectedSequence?.items.length ?? 0} is out.`}
            </span>
            <span className="text-xs text-muted">Press → for the next cue, ← to go back.</span>
            <span className="ml-auto flex items-center gap-1">
              <Button data-coach="presenter" size="sm" variant="flat" startContent={<Monitor size={15} />} onPress={openAudience}>Audience display</Button>
              <CoachHelp id="armed" />
            </span>
          </div>
        )}

        {/* Above the tabs: the shows, and beside them the script. Both go away while a library item
            is selected -- the toolbar takes their place -- and while a deck is armed. */}
        {!armed && !editingId && !picked.length && (!phone || pane === "shows") && (
          <ShowsBoard shows={shows} links={links} sequences={sequences} script={scriptDoc.html ? scriptDoc : null}
            showsGrid={showsGrid} scriptGrid={scriptGrid} busy={!signedIn} over={seqDrag.over}
            onCreateShow={addShow} onOpenShow={openShow} onDeleteShow={removeShow}
            onOpenScript={() => openScript(scriptMode === "split" ? "off" : "split")} onScriptToShow={scriptToShow} />
        )}

        {/* The sequence rail. It is a drop target for library cards and a drag source onto a show,
            so all three drags land on one screen without opening anything first. */}
        {!armed && !editingId && (!phone || pane === "deck") && (
          <section className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">Sequences</p>
              <Button data-tour="new-sequence" size="sm" variant="light" startContent={<Plus size={14} />} onPress={addSequence}>New sequence</Button>
              {selectedSequence && <Button size="sm" variant="light" startContent={<Copy size={14} />} onPress={duplicateSequence.bind(null, selectedSequence)}>Duplicate</Button>}
              {features.templates.length > 0 && <select aria-label="Create from template" value="" onChange={e => { if (e.target.value) createFromTemplate(e.target.value); }} className="rounded-xl border border-border bg-surface/60 px-2 py-1.5 text-sm outline-none focus:border-accent"><option value="">From template…</option>{features.templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select>}
              {selectedSequence && <Button size="sm" variant="light" startContent={<FileJson size={14} />} onPress={saveCurrentTemplate}>Save template</Button>}
              <div className="min-w-48 flex-1">
                <SearchBar query={seqQuery} setQuery={setSeqQuery} sort={seqSort} setSort={setSeqSort} kind={[]} setKind={() => {}} placeholder="Search sequences" />
              </div>
            </div>
            {shownSequences.length === 0 ? (
              <p className="text-sm text-muted">{sequences.length ? "Nothing matches that." : "No sequences yet. Make one, then drag sounds and slides onto it."}</p>
            ) : (
              <ol ref={seqDrag.list} className="flex flex-wrap gap-2">
                {shownSequences.map((s, i) => (
                  <li key={s.id} data-drop={`seq:${s.id}`}
                    className={`flex items-center gap-1 rounded-full border pr-1 transition-colors ${libDrag.over === `seq:${s.id}` ? "border-accent bg-accent/25" : s.id === sequenceId ? "border-accent bg-accent/15" : "border-border bg-surface/50"}`}>
                    <span role="button" tabIndex={-1} aria-label={`Drag ${s.name} onto a show`}
                      className="flex min-w-9 cursor-grab touch-pan-y items-center justify-center self-stretch text-muted hover:text-foreground active:cursor-grabbing"
                      onPointerDown={seqDrag.start(i)} onPointerMove={seqDrag.move} onPointerUp={seqDrag.end} onPointerCancel={seqDrag.end}>
                      <GripVertical size={13} aria-hidden />
                    </span>
                    <button data-tour={i === 0 ? "sequence-select" : undefined} className="py-1.5 text-sm font-semibold" onClick={() => { setSequenceId(s.id); setTab("sequence"); }}>{s.name}</button>
                    <span className="text-[11px] text-muted">{s.items.length}</span>
                    {/* A sequence does not need a show to be run: this arms it and opens the
                        presenter window, in a project, outside any show. */}
                    <Button isIconOnly size="sm" variant="light" aria-label={`Run ${s.name} in presenter mode`}
                      title="Run this sequence on its own, in presenter mode" isDisabled={!s.items.length}
                      onPress={() => startSequence(true, s)}><Play size={13} fill="currentColor" /></Button>
                    <Button isIconOnly size="sm" variant="light" aria-label={`Duplicate ${s.name}`} onPress={() => duplicateSequence(s)}><Copy size={13} /></Button>
                    <Button isIconOnly size="sm" variant="light" aria-label={`Rename ${s.name}`} onPress={() => openRename("sequence", s.id, s.name)}><Pencil size={13} /></Button>
                    <Button isIconOnly size="sm" variant="light" color="danger" aria-label={`Delete ${s.name}`} onPress={() => deleteSequence(s.id)}><Trash2 size={13} /></Button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {/* Selection toolbar. It is the only place the editor is opened from, which is why there is
            no longer an Editor tab: you open a thing, you do not visit a room. */}
        {!armed && !editingId && picked.length > 0 && (
          <div className="glass mt-4 flex flex-wrap items-center gap-2 p-3">
            <span className="text-sm font-semibold">{picked.length} selected</span>
            <Button size="sm" variant="flat" startContent={<SlidersHorizontal size={15} />} onPress={() => openEditor(picked[0])}>Edit</Button>
            <label className="flex items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 text-sm">
              <span className="sr-only">Add to sequence</span>
              <select value="" aria-label="Add to sequence" className="max-w-40 bg-transparent py-2 pr-1 text-sm outline-none"
                onChange={e => { addTracksTo(e.target.value, picked); e.target.value = ""; }}>
                <option value="">Add to sequence…</option>
                {sequences.map(s => <option key={s.id} value={s.id} className="bg-background">{s.name}</option>)}
              </select>
            </label>
            <Button size="sm" variant="flat" startContent={<Download size={15} />}
              onPress={() => picked.forEach(id => { const t = tracks.find(x => x.id === id); if (t && kindOf(t) !== "embed") void downloadAsset(t.url, t.title); })}>Download</Button>
            <Button size="sm" variant="flat" color="danger" startContent={<Trash2 size={15} />}
              onPress={() => { if (confirm(`Delete ${picked.length} item${picked.length === 1 ? "" : "s"} everywhere?`)) { picked.forEach(deleteTrack); setSelectedIds([]); } }}>Delete</Button>
            <Button size="sm" variant="light" className="ml-auto" onPress={() => setSelectedIds([])}>Deselect</Button>
          </div>
        )}

        <div className={scriptMode === "split" ? "mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,30rem)]" : "mt-6"}>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 }} className="min-w-0">
          {/* An item opens into the editor and closes back out of it. Two tabs, and neither is it. */}
          {editingId ? (
            <div className="space-y-4">
              <Button size="sm" variant="bordered" startContent={<ArrowLeft size={15} />} onPress={() => setEditingId("")}>Back to the library</Button>
              <Editor track={tracks.find(t => t.id === editingId)} cues={cuePoints(sequences, editingId)} busy={busy} update={updateEffects} updateVisual={updateVisual} bakeReverse={bakeReverse} onSave={addProcessedFile} onPreview={setEditUrl} onRename={() => { const t = tracks.find(x => x.id === editingId); if (t) openRename("track", t.id, t.title); }} />
            </div>
          ) : phone && pane !== "library" && pane !== "deck" ? null : (
          /* Armed, the library goes away: the deck is the only thing that matters and nothing on
             this screen should invite a stray click during a show. */
          /* On a phone the bar at the bottom of the screen is the tab list, so this one is hidden
             and follows it. Two tab strips for one choice is how the phone layout read as a
             shrunken desktop rather than a design. */
          <Tabs selectedKey={phone ? (pane === "deck" ? "sequence" : "library") : tab}
            onSelectionChange={k => { setTab(k as string); teach(k as "library" | "sequence"); }}
            classNames={{ tabList: armed || phone ? "hidden" : "glass-soft" }}>
            <Tab key="library" id="library" title={<span className="flex items-center gap-2"><Layers size={16} />Library</span>}>
              <Library tracks={shownTracks} total={scopedTracks.length} selectedId={selected?.id ?? ""} playingId={playing ? selected?.id ?? "" : ""} selectedIds={selectedIds} busy={busy} drag={libDrag} onPlay={playTrack} onToggleSelect={toggleSelect} onAdd={addFiles} onAddSlide={() => setSlideOpen(true)} onOpenEditor={openEditor} onRename={(id: string) => { const t = tracks.find(x => x.id === id); if (t) openRename("track", id, t.title); }} importAsset={importAsset} query={libQuery} setQuery={setLibQuery} sort={libSort} setSort={setLibSort} kind={libKind} setKind={setLibKind} favorites={features.favorites} collections={features.collections} scope={libScope} setScope={setLibScope} onNewCollection={newCollection} onToggleFavorite={(id: string) => updateFeatures(state => toggleFavorite(state, id))} onAddToCollection={addToNamedCollection} />
            </Tab>
            <Tab key="sequence" id="sequence" title={<span data-tour="deck-tab" className="flex items-center gap-2"><ListMusic size={16} />Sequences</span>}>
              <Sequences sequences={sequences} sequenceId={sequenceId} tracks={tracks} selectedTrack={selected} selectedCount={picked.length} addItem={addItem} deleteItem={deleteItem} moveItem={moveItem} reorder={reorder} setItemTransition={setItemTransition} linkCues={linkCues} unlinkCue={unlinkCue} playCue={playCue} cueIndex={cueIndex} loopSeq={loopSeq} setLoopSeq={setLoopSeq} startSequence={startSequence} stage={stage} clearStage={() => setStage(null)} cueTimers={features.cueTimers} setCueTimer={setCueTimer} rehearsal={features.rehearsal} onToggleRehearsal={toggleRehearsal} onSaveRehearsalNote={saveRehearsalNote} />
            </Tab>
          </Tabs>
          )}
        </motion.div>
        {(phone ? pane === "script" : scriptMode === "split") && (
          <div className="h-[75vh] min-w-0 xl:sticky xl:top-4">
            {/* Split is where the board opens it; popup and its own tab are still one control away. */}
            <label className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 text-sm">
              <span className="sr-only">Where the reader sits</span>
              <select data-coach="script" value={scriptMode} onChange={e => openScript(e.target.value as typeof scriptMode)}
                className="w-full bg-transparent py-2 text-sm outline-none">
                <option value="split">Reader: split screen</option>
                <option value="popup">Reader: popup window</option>
                <option value="tab">Reader: new tab</option>
                <option value="off">Close the reader</option>
              </select>
            </label>
            {/* BroadcastChannel never echoes to the window that posted, so this one raises its own. */}
            <ScriptReader doc={scriptDoc} setDoc={setScriptDoc}
              onAlert={(level, message, cue) => { showAlert(level, message); send({ type: "alert", level, message, cue }); }} />
          </div>
        )}
        </div>
      </div>

      {/**
        * The phone layout, and the reason it is not the desktop one shrunk: a phone shows one pane
        * at a time and switches between them from the bottom of the screen, where a thumb already
        * is. Stacked, these four sections were a scroll past three things you were not looking for
        * to reach the one you were.
        *
        * It stands down while a deck is armed, because the transport below owns the bottom of the
        * screen then and nothing may sit on top of the next-cue button. It also stands down in the
        * editor, which is a place you leave rather than a pane you switch away from.
        */}
      {phone && !armed && !editingId && (
        <nav aria-label="Studio panes"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-white/10 bg-background/95 pb-[max(.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
          {PANES.map(p => {
            const on = pane === p.id;
            return (
              <button key={p.id} type="button" data-tour={`pane-${p.id}`} aria-current={on} onClick={() => setPane(p.id)}
                className={`flex min-h-14 touch-manipulation flex-col items-center justify-center gap-1 pt-2 text-[11px] font-semibold transition-colors ${on ? "text-accent" : "text-muted"}`}>
                <p.icon size={19} aria-hidden />
                {p.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* Hidden in the editor: that tab has its own transport, and three play buttons on one screen
          is two too many. Visual assets have no transport at all. */}
      {/* A phone has no arrow keys. Armed, the deck gets a thumb-sized transport of its own. */}
      {armed && (
        // Above the sign-in nudge and anything else that docks itself down here: while a deck is
        // armed, nothing gets to sit on top of the next-cue button.
        <div data-coach="transport" className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-3 border-t border-white/10 bg-background/90 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden">
          <Button className="h-16 w-24 shrink-0 text-base" variant="flat" onPress={() => advance(-1)}>← Back</Button>
          {/* The one thing this screen exists to do, so it is the biggest thing on it. */}
          <Button data-coach="fire" className="h-16 flex-1 text-lg font-bold" color="primary" onPress={() => advance(1)}>
            {cueIndex < 0 ? "Fire cue 1" : "Next cue →"}
          </Button>
          {timerLeft > 0 && <span className="shrink-0 rounded-xl border border-armed/40 bg-armed/10 px-2 py-1 font-mono text-xs text-armed">{formatTimer(timerLeft)}</span>}
          {features.rehearsal.active && <span className="shrink-0 rounded-xl border border-live/40 bg-live/10 px-2 py-1 text-xs text-live">Rehearsal</span>}
          <CoachHelp id="transport" />
        </div>
      )}

      <AnimatePresence>{selected && !isVisual(selected) && !editingId && !armed && <Player key="player" track={selected} unsaved={!!editUrl} playing={playing} toggle={toggle} time={time} duration={duration} seek={seek} jump={jump} loop={loop} setLoop={setLoop} effects={selected.effects} update={updateEffects} />}</AnimatePresence>

      <Modal isOpen={renameModal.isOpen} onOpenChange={renameModal.onOpenChange} placement="center" backdrop="blur">
        <ModalContent>{onClose => (<>
          <ModalHeader>Rename {draft.kind}</ModalHeader>
          <ModalBody><Input autoFocus label="Name" value={draft.value} onValueChange={v => setDraft(d => ({ ...d, value: v }))} onKeyDown={e => { if (e.key === "Enter") { commitRename(); onClose(); } }} /></ModalBody>
          <ModalFooter><Button variant="light" onPress={onClose}>Cancel</Button><Button color="primary" onPress={() => { commitRename(); onClose(); }}>Save</Button></ModalFooter>
        </>)}</ModalContent>
      </Modal>

      <Modal isOpen={historyModal.isOpen} onOpenChange={historyModal.onOpenChange} placement="center" backdrop="blur">
        <ModalContent>{onClose => (<>
          <ModalHeader><span className="flex items-center gap-2"><History size={17} className="text-accent" />Run history</span></ModalHeader>
          <ModalBody>
            <div className="max-h-[55vh] space-y-1 overflow-y-auto">
              {features.runHistory.length ? [...features.runHistory].reverse().map(event => (
                <div key={event.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 px-3 py-2 text-sm">
                  <span className="w-20 shrink-0 font-mono text-xs text-muted">{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="min-w-0 flex-1"><b className="capitalize">{event.type}</b>{event.sequenceName ? ` · ${event.sequenceName}` : ""}{event.label ? ` · ${event.label}` : ""}</span>
                  {event.cueIndex !== undefined && <span className="font-mono text-xs text-muted">#{event.cueIndex + 1}</span>}
                </div>
              )) : <p className="py-8 text-center text-sm text-muted">No run activity yet. Fire a cue or start a rehearsal to create history.</p>}
            </div>
          </ModalBody>
          <ModalFooter><Button variant="light" onPress={() => { clearRunHistory(); onClose(); }}>Clear history</Button><Button color="primary" onPress={onClose}>Close</Button></ModalFooter>
        </>)}</ModalContent>
      </Modal>
      <CommandPalette open={paletteOpen} onOpen={() => setPaletteOpen(true)} onClose={() => setPaletteOpen(false)} commands={commands} />

      {/* A show is not a dialog over the project screen: opened, it is the screen. */}
      {managing && liveShow && (
        <ShowManager show={liveShow} setShow={s => { setLiveShow(s); if (!s) setManaging(false); }}
          projectId={project} sequences={sequences} tracks={tracks} script={scriptDoc.html ? scriptDoc : null}
          links={links} stage={stage} onClose={() => setManaging(false)}
          armedSequenceId={armed ? sequenceId : ""} cueIndex={cueIndex}
          onFlash={text => { showBus.current?.send({ type: "flash", text, from: "host" }); showAlert("warn", text); }}
          onResend={() => showBus.current?.send(deck())}
          onAddSequence={seqId => sequenceToShow(seqId, liveShow.id)} onAddScript={() => scriptToShow(liveShow.id)}
          onRunSequence={runSequence} onStage={t => show(t)}
          onAddToSequence={(seqId, trackId) => addTracksTo(seqId, [trackId])}
          onFire={playCue} onOpenAudience={openAudience} />
      )}

      <SlideComposer open={slideOpen} onClose={() => setSlideOpen(false)} onCreate={addProcessedFile} />
      </WorkSurface>
    </Shell>
  );
}

function Library({ tracks, total, selectedId, playingId, selectedIds, busy, drag, onPlay, onToggleSelect, onAdd, onAddSlide, onOpenEditor, onRename, importAsset, query, setQuery, sort, setSort, kind, setKind, favorites = [], collections = {}, scope = "", setScope, onNewCollection, onToggleFavorite, onAddToCollection }: any) {
  const shown: Track[] = tracks;
  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Soundboard and slides</p><h2 className="flex items-center gap-1 text-xl font-bold">Click a card to fire it<CoachHelp id="library" /></h2></div>
        <div className="flex flex-wrap gap-2">
          <Tooltip content="A blank 16:9 slide you can put a title on"><Button variant="bordered" isDisabled={busy} startContent={<Presentation size={16} />} onPress={onAddSlide}>New slide</Button></Tooltip>
          <Tooltip content="Audio, images and video from this device"><Button data-coach="add" as="label" color="primary" startContent={<Upload size={17} />}>Upload<input hidden type="file" accept={UPLOAD_ACCEPT} multiple onChange={onAdd} /></Button></Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Library view" value={scope} onChange={e => setScope?.(e.target.value)} className="rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-accent">
          <option value="">All library items</option><option value="favorites">Favorites</option>{Object.keys(collections).map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <Button size="sm" variant="light" startContent={<FolderPlus size={14} />} onPress={onNewCollection}>New collection</Button>
      </div>
      <SearchBar query={query} setQuery={setQuery} sort={sort} setSort={setSort} kinds={["audio", "image", "video", "embed"]} kind={kind} setKind={setKind} placeholder="Search the library" />
      <SearchPanel importAsset={importAsset} />

      {shown.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid place-items-center rounded-2xl border border-dashed border-default-200 py-16 text-center">
          <LogoMark size={40} className="opacity-45" />
          <p className="mt-3 font-semibold">{total ? "Nothing matches that" : "Nothing here yet"}</p>
          <p className="text-sm text-muted">{total ? "Clear the search to see everything." : "Upload audio, images or video, or search the free libraries above."}</p>
        </motion.div>
      ) : (
        <motion.div layout className="auto-grid">
          <AnimatePresence>{shown.map((t: Track, i: number) => {
            const isPlaying = playingId === t.id, pick = selectedIds.indexOf(t.id), isChecked = pick >= 0;
            const kind = kindOf(t), Icon = kindIcon[kind];
            return (
            <motion.div key={t.id} layout initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} transition={{ delay: Math.min(i * .03, .3) }} whileHover={{ y: -3 }}>
              <Card data-tour={i === 0 ? "library-card" : undefined} isPressable onPress={() => onPlay(t)} className={`w-full overflow-hidden border ${isPlaying ? "border-accent bg-accent/15" : selectedId === t.id ? "border-accent/60 bg-accent/5" : "border-border bg-surface/60"} ${t.pending ? "opacity-70" : ""}`}>
                {kind === "image" && <img src={t.url} alt="" className="h-24 w-full object-cover" />}
                {kind === "video" && <video src={t.url} muted preload="metadata" className="h-24 w-full object-cover" />}
                <CardBody className="gap-2">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${isPlaying ? "bg-accent text-accent-foreground" : "bg-surface-secondary text-foreground"}`}>
                      {t.pending ? <Spinner size="sm" /> : kind !== "audio" ? <Icon size={15} /> : isPlaying ? <Pause fill="currentColor" size={15} /> : <Play fill="currentColor" size={15} />}
                    </span>
                    <p className="min-w-0 flex-1 truncate pt-1.5 font-semibold capitalize leading-tight">{t.title}</p>
                    <div className="flex shrink-0 gap-1">
                      {/* Same grip, same long-press, same haptic as a cue row: this one carries the
                          card out of the library and onto a sequence chip. */}
                      <span role="button" tabIndex={-1} aria-label={`Drag ${t.title} onto a sequence`}
                        className="flex min-w-9 cursor-grab touch-pan-y items-center justify-center self-stretch text-muted hover:text-foreground active:cursor-grabbing"
                        onPointerDown={drag.start(i)} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.end}>
                        <GripVertical size={14} aria-hidden />
                      </span>
                      <Tooltip content={isChecked ? `Cue ${pick + 1} of the selection, click to drop it` : "Select (shift-click to take a run)"}>
                        <Button isIconOnly size="sm" variant={isChecked ? "solid" : "light"} color={isChecked ? "primary" : "default"} onPress={(e: any) => onToggleSelect(t.id, i, !!e?.shiftKey)}>
                          {isChecked ? <span className="text-xs font-bold tabular-nums">{pick + 1}</span> : <Check size={14} />}
                        </Button>
                      </Tooltip>
                      <Tooltip content={favorites.includes(t.id) ? "Remove favorite" : "Add favorite"}><Button isIconOnly size="sm" variant={favorites.includes(t.id) ? "solid" : "light"} color={favorites.includes(t.id) ? "primary" : "default"} aria-label={favorites.includes(t.id) ? `Remove ${t.title} from favorites` : `Favorite ${t.title}`} onPress={() => onToggleFavorite?.(t.id)}><Star size={14} fill={favorites.includes(t.id) ? "currentColor" : "none"} /></Button></Tooltip>
                      <Tooltip content="Add to a collection"><Button isIconOnly size="sm" variant="light" aria-label={`Add ${t.title} to a collection`} onPress={() => onAddToCollection?.(t.id)}><FolderPlus size={14} /></Button></Tooltip>
                      <Tooltip content="Open in the editor"><Button isIconOnly size="sm" variant="light" aria-label={`Open ${t.title} in the editor`} onPress={() => onOpenEditor(t.id)}><SlidersHorizontal size={14} /></Button></Tooltip>
                      <Tooltip content="Rename"><Button isIconOnly size="sm" variant="light" aria-label={`Rename ${t.title}`} onPress={() => onRename(t.id)}><Pencil size={14} /></Button></Tooltip>
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

// "My library" is gone: the library has its own search box above this one, and two boxes that both
// claim to search the library is how they end up disagreeing.
const SOURCES: { id: Source; label: string }[] = [
  { id: "archive", label: "Internet Archive" },
  { id: "commons", label: "Wikimedia Commons" },
  { id: "openverse", label: "Openverse (stock audio + images)" },
  { id: "myinstants", label: "Myinstants" },
  { id: "url", label: "Paste a link" },
];

function SearchPanel({ importAsset }: { importAsset: (title: string, url: string) => void }) {
  const [source, setSource] = useState<Source>("archive");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const query = q.trim();
    setNote("");
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
  const placeholder = source === "url" ? "Paste a direct media link (.mp3, .wav, .png, .mp4) or a Google Slides link" : source === "myinstants" ? "Search Myinstants (e.g. airhorn, vine boom)" : "Search freely licensed audio";

  return (
    <div className="glass-soft space-y-3 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><Search size={15} className="text-accent" /> Find media</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Where to search" value={source}
          onChange={e => { setSource(e.target.value as Source); setHits([]); setNote(""); }}
          className="rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-accent">
          {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <Input className="min-w-56 flex-1" size="sm" value={q} onValueChange={setQ}
          placeholder={placeholder} onKeyDown={(e: any) => e.key === "Enter" && void run()} />
        <Button size="sm" color="primary" variant="flat" isLoading={loading} endContent={source === "myinstants" ? <ExternalLink size={14} /> : undefined} onPress={() => void run()}>
          {source === "url" ? "Import" : "Search"}
        </Button>
      </div>
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

function Editor({ track, cues, busy, update, updateVisual, bakeReverse, onSave, onPreview, onRename }: any) {
  if (!track) return <div className="mt-5 rounded-2xl border border-dashed border-default-200 py-16 text-center text-muted">Select something in the Library to edit it.</div>;
  const kind = kindOf(track);
  const heading = (
    <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Non-destructive editor</p>
      <h2 className="flex items-center gap-2 text-xl font-bold capitalize">{track.title}<Button isIconOnly size="sm" variant="light" onPress={onRename}><Pencil size={15} /></Button><CoachHelp id="editor" /></h2></div>
  );
  if (kind !== "audio") return (
    <div className="mt-5 space-y-6">
      {heading}
      <p className="max-w-2xl text-sm text-muted">
        {kind === "embed"
          ? "An embedded deck. Edit the slides in Google Slides or PowerPoint itself; the transition and caption below are what CueFlow adds when the cue fires."
          : "Framing, colour and timing ride with this asset and are applied when the cue fires, so the original file is never touched. Flatten to a new image if you want a copy with the look baked in."}
      </p>
      <MediaEditor track={track} cues={cues} onChange={updateVisual} onSave={onSave} />
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

function Sequences({ sequences, sequenceId, tracks, selectedTrack, selectedCount, addItem, deleteItem, moveItem, reorder, setItemTransition, linkCues, unlinkCue, playCue, cueIndex, loopSeq, setLoopSeq, startSequence, stage, clearStage, cueTimers = {}, setCueTimer, rehearsal = { active: false, completed: [], notes: {} }, onToggleRehearsal, onSaveRehearsalNote }: any) {
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
        {/* The list of sequences is the rail above the tabs, because a library card has to be able to
            land on one without changing tab. This panel is only ever the one that is open. */}
        <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Manual cue deck</p><h2 className="flex items-center gap-1 text-xl font-bold">{seq ? seq.name : "Sequences"}<CoachHelp id="sequence" /></h2></div>
      </div>
      {!seq ? (
        <div className="rounded-2xl border border-dashed border-default-200 py-16 text-center text-muted">Pick a sequence in the rail above, or make one. Then add sounds and slides from the Library. It never autoplays, drive it with the ← → arrow keys or click a cue.</div>
      ) : (
        <div className="space-y-3">
          <div className="glass-soft flex flex-wrap items-center gap-3 p-3">
            <Tooltip content="Arms the deck. Nothing plays until you press →"><Button size="sm" color="primary" startContent={<Play size={14} fill="currentColor" />} isDisabled={!seq.items.length} data-coach="arm" onPress={() => startSequence(false)}>Arm</Button></Tooltip>
            <Tooltip content="Opens the presenter window and arms the deck"><Button size="sm" color="secondary" variant="flat" startContent={<Monitor size={14} />} isDisabled={!seq.items.length} onPress={() => startSequence(true)}>Arm in audience mode</Button></Tooltip>
            <Switch size="sm" isSelected={loopSeq} onValueChange={setLoopSeq}>Loop sequence</Switch>
            <Switch size="sm" isSelected={rehearsal.active} onValueChange={onToggleRehearsal}><NotebookPen size={14} /> Rehearsal</Switch>
            {/* Off, a grip needs a long press so a thumb can still scroll the deck. On, grips drag
                the moment you touch them and the list stops scrolling under your finger. */}
            <Switch size="sm" isSelected={cueDrag.reorder} onValueChange={cueDrag.setReorder}>Reorder mode</Switch>
            <span className="ml-auto text-xs text-muted">{cueDrag.reorder ? "Drag any grip to move a cue. Scrolling is off while this is on." : cueIndex < 0 ? "Armed. Press → to fire cue 1" : "← → step every cue, A / D step slides only, W / S zoom"}</span>
          </div>

          {/* What the audience window is showing. Also the whole preview when no window is open. */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* min-w-0: a grid item's min width is its content by default, and a cue row full of
                controls is wider than a phone -- without this the whole deck scrolls sideways. */}
            <div className="order-2 min-w-0 space-y-3 lg:order-1">
              <div className="flex items-center gap-2 text-sm text-muted">
                <span>{selectedCount > 1 ? <>Adds <b className="text-foreground">{selectedCount} selected items</b>.</> : <>Adds the selected item{selectedTrack ? <> (<b className="text-foreground">{selectedTrack.title}</b>)</> : ""}.</>}</span>
                <Button data-tour="add-cue" size="sm" variant="flat" color="primary" startContent={<Plus size={14} />} isDisabled={!selectedTrack && !selectedCount} onPress={addItem}>Add {selectedCount > 1 ? `${selectedCount} cues` : "cue"}</Button>
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
                      <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${held ? "border-accent bg-accent/15 shadow-lg" : i === cueIndex ? "border-accent bg-accent/10" : "border-border bg-surface/50"}`}>
                        {/* A 15px icon is a 15px target. The grip fills the row's height and is wide
                            enough to hit without looking, which is how it actually gets used --
                            negative margins keep the row's own spacing unchanged. */}
                        {/* touch-action is explicit both ways: pan-y hands a scroll straight back to
                            the page unless the finger holds still, none claims the gesture outright
                            once reorder mode is on. */}
                        <span
                          role="button" tabIndex={-1} aria-label={`Reorder ${item.label}`}
                          className={`-my-2.5 -ml-3 flex min-w-11 shrink-0 cursor-grab items-center justify-center self-stretch px-3 py-3 text-muted hover:text-foreground active:cursor-grabbing ${cueDrag.reorder ? "touch-none text-accent" : "touch-pan-y"}`}
                          onPointerDown={cueDrag.start(i)} onPointerMove={cueDrag.move}
                          onPointerUp={cueDrag.end} onPointerCancel={cueDrag.end}
                        >
                          <GripVertical size={15} aria-hidden />
                        </span>
                        <button data-coach={i === 0 ? "fire" : undefined} className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => playCue(i)}>
                          <span className={`w-6 shrink-0 rounded-md text-center font-mono text-sm font-bold ${kind === "audio" ? "bg-audio/15 text-audio" : "bg-visual/15 text-visual"}`}>{numbers[i]}</span>
                          <Icon size={14} className="shrink-0 text-muted" aria-hidden />
                          <span className="truncate font-medium capitalize">{item.label}</span>
                          {rehearsal.active && rehearsal.completed.includes(item.id) && <span className="rounded-full bg-live/15 px-1.5 py-0.5 text-[10px] font-semibold text-live">rehearsed</span>}
                          {timerLeftFor(item.id, cueTimers) > 0 && <span className="rounded-md bg-armed/15 px-1.5 py-0.5 font-mono text-[10px] text-armed">{formatTimer(timerLeftFor(item.id, cueTimers))}</span>}
                          {item.link && <span className="shrink-0 rounded-md bg-visual/15 px-1.5 font-mono text-[11px] font-bold text-visual" title="Fires together with this cue">+{numbers[order.findIndex((x: SequenceItem) => x.id === item.link)] ?? "?"}</span>}
                          <span className="ml-auto hidden shrink-0 text-xs text-muted sm:inline">{track?.title ?? "missing"}</span>
                        </button>
                        {/* On a phone the transition picker takes its own line under the cue rather
                            than eating the label down to one letter. */}
                        <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
                          <label className="flex items-center gap-1 text-[10px] text-muted" title="Seconds before the next cue fires automatically">
                            <Clock3 size={12} /><input aria-label={`Auto advance seconds for ${item.label}`} type="number" min="0" max="3600" value={cueTimers[item.id] ?? 0} onChange={e => setCueTimer?.(item.id, Number(e.target.value))} className="w-14 rounded-md border border-border bg-surface/60 px-1.5 py-1 font-mono text-xs outline-none focus:border-accent" />s
                          </label>
                          {rehearsal.active && <input aria-label={`Private rehearsal note for ${item.label}`} defaultValue={rehearsal.notes?.[item.id] ?? ""} onBlur={e => onSaveRehearsalNote?.(item.id, e.target.value)} placeholder="note" className="w-24 rounded-md border border-border bg-surface/60 px-2 py-1 text-xs outline-none focus:border-accent" />}
                        </div>
                        {kind !== "audio" && (
                          <select aria-label="Transition" value={item.visual?.transition ?? "fade"} onChange={e => setItemTransition(item.id, e.target.value)}
                            className="order-last w-full shrink-0 rounded-lg border border-border bg-surface/60 px-2 py-1 text-xs capitalize outline-none focus:border-accent sm:order-none sm:w-auto">
                            {["cut", "fade", "slide", "zoom"].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        )}
                        <div className="flex shrink-0">
                          {/* Two clicks: chain this cue, then click the one it goes with. */}
                          {linking && linking !== item.id ? (
                            <Button size="sm" variant="flat" color="primary" onPress={() => { linkCues(linking, item.id); setLinking(""); }}>Link here</Button>
                          ) : (
                            <Tooltip content={item.link ? `Linked to cue ${numbers[order.findIndex((x: SequenceItem) => x.id === item.link)] ?? "?"}, click to unlink` : linking === item.id ? "Now click the cue this goes with" : "Fire this cue together with another"}>
                              <Button isIconOnly size="sm" variant={item.link || linking === item.id ? "solid" : "light"} color={item.link ? "secondary" : linking === item.id ? "primary" : "default"}
                                onPress={() => { if (item.link) { unlinkCue(item.id); setLinking(""); } else setLinking(l => (l === item.id ? "" : item.id)); }}>
                                {item.link ? <Unlink size={14} /> : <Link2 size={15} />}
                              </Button>
                            </Tooltip>
                          )}
                          {/* The chevrons are the mouse's answer to reordering; a thumb has the grip
                              and they are the two controls a 375px row can least afford. */}
                          <span className="hidden sm:contents">
                            <Tooltip content="Move up"><Button isIconOnly size="sm" variant="light" isDisabled={i === 0} onPress={() => moveItem(i, -1)}><ChevronUp size={15} /></Button></Tooltip>
                            <Tooltip content="Move down"><Button isIconOnly size="sm" variant="light" isDisabled={i === seq.items.length - 1} onPress={() => moveItem(i, 1)}><ChevronDown size={15} /></Button></Tooltip>
                          </span>
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
    // Docked flush to the bottom edge on a phone -- a floating card wastes the one strip of screen a
    // thumb reaches without moving the hand. It floats again once there is room.
    <motion.section initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="glass fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[1080px] rounded-none p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:inset-x-4 sm:bottom-4 sm:rounded-lg sm:p-4">
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

