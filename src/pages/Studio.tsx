import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Button, Card, CardBody, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, Slider, Spinner, Switch, Tab, Tabs, Tooltip, useDisclosure } from "../ui";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, ChevronDown, ChevronUp, FileText, Link2, Unlink, Download, ExternalLink, FastForward, Film, GripVertical, Image as ImageIcon, Layers, ListMusic, Monitor, Pause, Pencil, Play, Plus, Presentation, Radio, Repeat, Rewind, RotateCcw, Search, SlidersHorizontal, Square, Trash2, TriangleAlert, Upload, Volume2, Undo2, Redo2, Star, FolderPlus, Clock3, History, NotebookPen, Command, FileJson, Copy, MoreHorizontal } from "lucide-react";
import { useDeviceCapabilities, useIsPhone } from "../lib/layout";
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
import { currentProject, setCurrentProject } from "../lib/projects";
import { createShow, deleteShow, listShows, memberPerms, SCRIPT_LIMIT, updateShow, type Perm, type Show, type ShowMsg } from "../lib/shows";
import { useShowLink } from "../lib/showLink";
import { linksOf, loadLinks, saveLinks, withScript, withSequence, withoutShow, type LinkMap } from "../lib/showLinks";
import Stage from "../components/Stage";
import ShareButton from "../components/ShareButton";
import WaveformEditor from "../components/WaveformEditor";
import { fetchMedia } from "../lib/api";
import { AudioEngine, decodeAudioUrl, makeReversedFile, peaks, VoicePool } from "../lib/audio";
import { listen, send, type Msg } from "../lib/bus";
import { linkSequenceItems, unlinkSequenceItem } from "../lib/sequenceLinks";
import { moved, useDragList } from "../lib/dragList";
import CommandPalette, { type PaletteCommand } from "../components/CommandPalette";
import { addToCollection, buildProjectExport, formatTimer, loadFeatures, makeTemplate, readProjectExport, recordHistory, redoSequences, removeFromCollections, saveDownload, saveFeatures, setCollection, toggleFavorite, undoSequences, type FeatureState } from "../lib/features";
// Aliased: `SearchPanel` already has a local `search` for the media-source lookup.
import { search as rank, type Facet, type SortKey } from "../lib/search";
import { cuePoints } from "../lib/trim";
import { downloadAsset, embedUrl, kindFromFile, kindFromUrl, prettyName, resolveHit, searchArchive, searchCommons, searchOpenverse, uniqueTitle, type Hit, type Source } from "../lib/media";
import { deleteSequenceEverywhere, deleteTrackEverywhere, hydrateCloud, isDeleted, local, mergeInto, onAuth, persist, uploadTrack, watchCloud } from "../lib/store";
import { autoSave, flushSave, onSyncResult } from "../lib/autosync";
import { toast } from "../lib/toast";
import { cloneEffects, cueNumbers, defaultEffects, defaultVisual, isVisual, kindOf, Effects, Kind, Sequence, SequenceItem, Stage as StageState, Track, Visual, type DeckSlide } from "../types";
import { loadAlertScope, type AlertScope } from "../lib/alerts";
import { slideLabels, slidesFromPptx } from "../lib/presentation";

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
const projectLink = new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("project");
if (projectLink) setCurrentProject(projectLink);
const project = currentProject();
const studioShareUrl = (params: Record<string, string>) => {
  const search = new URLSearchParams(project ? { project } : {});
  Object.entries(params).forEach(([key, value]) => search.set(key, value));
  return `/studio?${search.toString()}`;
};
const key = (k: string) => (project ? `${k}:${project}` : k);
const patch = (arr: Track[], id: string, p: Partial<Track>) => arr.map(t => t.id === id ? { ...t, ...p } : t);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const kindIcon = { audio: Volume2, image: ImageIcon, video: Film, embed: Presentation };
const UPLOAD_ACCEPT = "audio/*,image/*,video/*,.ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation";

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
  // crossOrigin must be set before src/load so MediaElementAudioSourceNode is not silenced by CORS.
  const audio = useRef<HTMLAudioElement>(Object.assign(new Audio(), { crossOrigin: "anonymous", preload: "auto" }));
  const engine = useRef(new AudioEngine());
  /**
   * Cues get their own voices, so two sounds can be out at once. The element above stays the
   * editor's: scrubbing, the waveform and the Player all act on the track you have open, and firing
   * a cue no longer yanks that out from under you.
   */
  const voices = useRef(new VoicePool());
  const playRequest = useRef(0);
  const cuePreloaders = useRef<HTMLAudioElement[]>([]);
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
  const lastAudioId = useRef(""); // opening a visual card must not erase the audio chosen for slide linking
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
  // Mobile panes are destinations, not sections in one long document. Reset after the new pane has
  // committed so Library -> Deck and every other bottom-nav change always starts at its own top.
  useEffect(() => {
    if (!phone) return;
    let second: number | null = null;
    const reset = () => { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; window.scrollTo({ top: 0, left: 0, behavior: "auto" }); };
    const frame = requestAnimationFrame(() => { reset(); second = requestAnimationFrame(reset); });
    return () => { cancelAnimationFrame(frame); if (second !== null) cancelAnimationFrame(second); };
  }, [pane, phone]);
  /**
   * The tutorial writes a demo library straight to localStorage and then asks the page to re-read
   * it. It used to call `location.reload()` for this, which threw away an unsaved edit, a fired cue
   * and any open show in order to show somebody a demo.
   */
  useEffect(() => {
    const reread = () => {
      setTracks(local.get(key("tracks"), []));
      setSequences(local.get(key("sequences"), []));
    };
    window.addEventListener("cueflow:demo-loaded", reread);
    return () => window.removeEventListener("cueflow:demo-loaded", reread);
  }, []);
  useEffect(() => {
    const onTourPane = (event: Event) => {
      const next = (event as CustomEvent<PaneId>).detail;
      if (!PANES.some(candidate => candidate.id === next)) return;
      if (phone) { setPane(next); return; }
      // A desk has tabs where a phone has panes. This used to bail out on desktop entirely, so tour
      // steps 6 and 7 pointed at controls inside a tab the tour had no way of opening.
      if (next === "library") setTab("library");
      if (next === "deck") setTab("sequence");
    };
    window.addEventListener("cueflow:tour-pane", onTourPane);
    return () => window.removeEventListener("cueflow:tour-pane", onTourPane);
  }, [phone]);
  const [playing, setPlaying] = useState(false);
  /** Bumped whenever a voice starts, stops or is stolen, so the transport redraws. Cheap on purpose. */
  const [voiceTick, setVoiceTick] = useState(0);
  /** The soundboard, and which bank of ten it is showing. Open by default once a deck is armed. */
  const [padsOpen, setPadsOpen] = useState(true);
  const [padBank, setPadBank] = useState(0);
  /**
   * One level over everything, which the desk has never had: per-cue volume was the only control, so
   * "the whole show is too loud in this room" meant editing every cue. Scales what each voice plays
   * at rather than touching the stored effects, so it is a monitor control and never edits the show.
   */
  const [master, setMaster] = useState(() => {
    const held = Number(localStorage.getItem("cueflow:master"));
    return Number.isFinite(held) && held >= 0 && held <= 1 ? held : 1;
  });
  const masterRef = useRef(master); masterRef.current = master;
  const commitMaster = () => { try { localStorage.setItem("cueflow:master", String(masterRef.current)); } catch { /* storage is off; the level still holds for this session */ } };
  /** What each voice would play at with the master wide open, so moving the master is not cumulative. */
  const voiceLevel = useRef(new Map<number, number>());
  useEffect(() => {
    for (const voice of voices.current.all()) {
      if (voice.trackId) voice.element.volume = (voiceLevel.current.get(voice.id) ?? 1) * master;
    }
    audio.current.volume = (selectedRef.current?.effects.volume ?? 1) * master;
  }, [master]);
  // `time` and `duration` used to live here. Only the Player reads them, and `timeupdate` fires
  // about four times a second, so holding them here re-rendered all of Studio -- the whole library
  // grid and cue list, each wrapped in `motion.div layout` -- four times a second during playback.
  // The Player subscribes to the element itself now; the fade-out below needs no state at all.
  const [busy, setBusy] = useState(false);
  const [editUrl, setEditUrl] = useState(""); // unsaved editor buffer, as a blob URL, takes over playback for the selected track
  const wasEditing = useRef(false);
  const [stage, setStage] = useState<StageState>(null); // what the audience window is showing
  const [armed, setArmed] = useState(false);            // deck is loaded and the arrows are hot
  const [scriptMode, setScriptMode] = useState<"off" | "split" | "popup" | "tab">("off");
  const [scriptDoc, setScriptDoc] = useState<ScriptDoc>(() => loadScript());
  const [flash, setFlash] = useState<"warn" | "hit" | null>(null);
  const [alertNote, setAlertNote] = useState("");
  const [alertScope, setAlertScope] = useState<AlertScope>(() => loadAlertScope());
  const alertTimer = useRef(0);
  useEffect(() => {
    const onScope = (event: Event) => setAlertScope((event as CustomEvent<AlertScope>).detail);
    window.addEventListener("cueflow:alert-scope", onScope);
    return () => window.removeEventListener("cueflow:alert-scope", onScope);
  }, []);
  /** Flash the control screen and hold the words a moment longer than the flash itself. */
  const showAlert = (level: "warn" | "hit", message: string) => {
    if (alertScope !== "operator") return;
    setAlertNote(message);
    setFlash(level);
    clearTimeout(alertTimer.current);
    alertTimer.current = window.setTimeout(() => setFlash(null), level === "hit" ? 1600 : 1100);
    window.setTimeout(() => setAlertNote(n => (n === message ? "" : n)), 6000);
  };
  const renameModal = useDisclosure();
  const historyModal = useDisclosure();
  const [draft, setDraft] = useState<{ kind: "track" | "sequence"; id: string; value: string }>({ kind: "track", id: "", value: "" });
  const [sequenceMenuFor, setSequenceMenuFor] = useState<string | null>(null);
  useEffect(() => {
    if (!sequenceMenuFor) return;
    const close = () => setSequenceMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [sequenceMenuFor]);

  // The show: one performance across every device in the room. The channel lives here rather than in
  // the host panel because the things worth broadcasting -- a cue going out, the stage changing --
  // happen out here, and a panel that is closed must not stop them reaching anyone.
  const [liveShow, setLiveShow] = useState<Show | null>(null);
  // The manager is a screen, not a dialog, so it is a flag rather than a disclosure. Closing it
  // leaves `liveShow` alone on purpose: the channel outlives the panel, or a host who shut the
  // manager would stop hearing the room.
  const [managing, setManaging] = useState(false);
  const onShowMsg = useRef<(m: ShowMsg) => void>(() => {});
  /**
   * Who is in the room, learned from their own `here` and kept until the show closes.
   *
   * The host needs this for two things. One is the roster the manager draws. The other is that a
   * deck is now addressed: the script goes only to a member the server says holds `script`, so the
   * host has to know who asked before it can answer. A resend with an empty roster carries no
   * script at all, which is the safe way round.
   */
  const roster = useRef(new Map<string, { name: string; role: string | null; perms: Perm[]; at: number }>());
  const [members, setMembers] = useState<{ member: string; name: string; role: string | null; perms: Perm[] }[]>([]);
  // The shows section above the tabs. Shows are an account feature, so signed out there is none.
  const signedIn = useSignedIn();
  const [shows, setShows] = useState<Show[]>([]);
  const [showsLoading, setShowsLoading] = useState(true);
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
  const featureRef = useRef(features); featureRef.current = features;
  const sequenceRef = useRef(sequences); sequenceRef.current = sequences;
  /**
   * One index instead of a linear scan per cue per render. Every `tracks.find(t => t.id === …)` on a
   * hot path used to be O(n) inside an O(m) loop, and those loops run on the 4 Hz playback render and
   * the 10 Hz cue-timer render, not only on edits.
   */
  const trackById = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  useEffect(() => {
    let changed = false;
    const expanded = sequences.map(sequence => {
      const items = sequence.items.flatMap(item => {
        const track = trackById.get(item.trackId);
        if (track?.kind !== "embed" || !track.slides?.length || item.slideIndex !== undefined) return [item];
        changed = true;
        return track.slides.map(slide => ({
          ...item,
          id: crypto.randomUUID(),
          label: `${track.title} · ${slide.label}`,
          slideIndex: slide.index,
          link: undefined,
        }));
      });
      return items.length === sequence.items.length ? sequence : { ...sequence, items };
    });
    if (changed) { sequenceRef.current = expanded; setSequences(expanded); }
  }, [tracks]);
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
    if (!email) { setShows([]); setShowsLoading(false); return; }
    setShowsLoading(true);
    void listShows(project).then(list => { setShows(list); if (list.length) gridOn(true); }).catch(() => setShows([])).finally(() => setShowsLoading(false));
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
  const scopedTracks = useMemo(
    () => libScope === "favorites" ? tracks.filter(t => features.favorites.includes(t.id)) : libScope ? tracks.filter(t => (features.collections[libScope] ?? []).includes(t.id)) : tracks,
    [tracks, libScope, features.favorites, features.collections],
  );
  // `rank` maps, filters and sorts the whole list, and `norm` NFD-normalises per item per comparison.
  // Unmemoised it ran on every render, which includes the 4 Hz playback tick and the 10 Hz cue timer.
  const shownTracks = useMemo(
    () => rank(scopedTracks, trackFacet, { query: libQuery, filter: { kind: libKind }, sort: libSort }),
    [scopedTracks, libQuery, libKind, libSort],
  );
  const [seqQuery, setSeqQuery] = useState("");
  const [seqSort, setSeqSort] = useState<SortKey>("importance");
  const seqFacet: Facet<Sequence> = s => ({ text: [s.name, ...s.items.map(i => i.label)], kind: "sequence", createdAt: s.createdAt });
  const shownSequences = useMemo(
    () => rank(sequences, seqFacet, { query: seqQuery, sort: seqSort }),
    [sequences, seqQuery, seqSort],
  );

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
  const showLink = useShowLink(liveShow?.id ?? null, m => onShowMsg.current(m));
  const sendShow = showLink.send;
  useEffect(() => { roster.current.clear(); setMembers([]); }, [liveShow?.id]);
  // Starting and ending are the two moments every device has to hear about, and the stage changing
  // is the only other thing a device might be mirroring. Both resend rather than diff: a deck is
  // small, and a device that missed one message would otherwise stay wrong all night.
  useEffect(() => { if (liveShow) sendShow(liveShow.startedAt ? { type: "start", at: liveShow.startedAt } : { type: "end" }); }, [liveShow?.startedAt, showLink.ready]);

  const selected = trackById.get(selectedId) ?? tracks[0];
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const selectedSequence = useMemo(() => sequences.find(s => s.id === sequenceId), [sequences, sequenceId]);
  useEffect(() => {
    if (selected && !isVisual(selected)) lastAudioId.current = selected.id;
  }, [selected?.id]);
  // Armed effects belong to the audio cue currently under the playhead. If the deck is armed but
  // nothing has fired yet, use its first audio cue so operators can prepare the next hit.
  const armedAudioItem = useMemo(() => {
    if (!selectedSequence) return undefined;
    const before = cueIndex >= 0 ? selectedSequence.items.slice(0, cueIndex + 1).reverse() : [];
    const candidates = [...before, ...selectedSequence.items];
    return candidates.find(item => kindOf(trackById.get(item.trackId) ?? { kind: "audio" }) === "audio");
  }, [selectedSequence, cueIndex, trackById]);
  const armedEffects: Effects = { ...defaultEffects(), ...(armedAudioItem?.effects ?? selected?.effects ?? {}) };
  useEffect(() => { audio.current.loop = loop; }, [loop]);
  /**
   * The URLs the deck is about to need, and nothing else. This used to key off `tracks`, so any
   * `setTracks` -- a rename, an upload progress patch, one frame of an effects slider -- tore down
   * and rebuilt up to eight media elements, each with its own `load()`. Keying off the URLs
   * themselves means the preloaders are rebuilt when what they should hold actually changes.
   */
  const cueAudioUrls = useMemo(() => {
    const ids = [...new Set((selectedSequence?.items ?? []).map(item => item.trackId))];
    return ids.map(id => trackById.get(id)).filter((t): t is Track => !!t && !isVisual(t)).slice(0, 8).map(t => t.url);
  }, [selectedSequence, trackById]);
  const cueAudioSignature = cueAudioUrls.join("\n");
  useEffect(() => {
    const drop = () => {
      cuePreloaders.current.forEach(preloader => { preloader.pause(); preloader.removeAttribute("src"); preloader.load(); });
      cuePreloaders.current = [];
    };
    drop();
    cuePreloaders.current = cueAudioSignature ? cueAudioSignature.split("\n").map(url => {
      const preloader = new Audio(url);
      preloader.preload = "auto";
      preloader.load();
      return preloader;
    }) : [];
    return drop;
  }, [cueAudioSignature]);
  // Prime the browser media element and Web Audio graph before a cue is called. The first call should
  // spend its time making sound, not fetching metadata or constructing the filter chain.
  useEffect(() => {
    const a = audio.current;
    a.preload = "auto";
    if (!selected || isVisual(selected)) return;
    const src = editUrl && selected.id === selectedId ? editUrl : selected.url;
    const absolute = new URL(src, location.href).href;
    if (a.src !== absolute) { a.src = src; a.load(); }
    engine.current.apply(a, selected.effects);
  }, [selected?.id, selected?.url, selectedId, editUrl]);

  const lastSyncNote = useRef("");
  // Sync is on and has no button: it runs on every change and only speaks up when it fails, once
  // per distinct reason, so a broken save is visible on the device it happens on rather than at the
  // next show. `autoSave` is the app's one save path -- this used to be a third inline copy of the
  // same debounce, sitting beside the one in `autosync.ts` and the queue inside `persist`.
  useEffect(() => onSyncResult(state => {
    const note = state.ok ? "" : state.reason ?? "unknown error";
    if (note && note !== lastSyncNote.current) toast("Couldn't save to your account", note, "warn");
    lastSyncNote.current = note;
  }), []);
  useEffect(() => { autoSave(tracks, sequences, project); }, [tracks, sequences]);
  // Leaving without waiting out the debounce must not lose the last edit.
  useEffect(() => {
    const leave = () => { void flushSave(data.current.tracks, data.current.sequences, project); };
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); leave(); };
  }, []);
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
  /**
   * Another device changed something. Pull and merge rather than reload: the merge is three-way and
   * knows the difference between their edit and yours, so nothing being worked on is lost.
   */
  useEffect(() => watchCloud(project, () => { void mergeCloud(); }), []);
  // On sign-in: pull the account's saved data and push whatever is currently local up to it.
  useEffect(() => onAuth(email => { if (!email) return; void mergeCloud().then(() => persist(data.current.tracks, data.current.sequences, project)); }), []);
  useEffect(() => {
    const a = audio.current;
    const tick = () => {
      const fx = selectedRef.current?.effects;
      const fade = fx?.fadeOut ?? 0;
      if (fade && Number.isFinite(a.duration) && a.duration - a.currentTime <= fade) a.volume = Math.max(0, fx!.volume * (a.duration - a.currentTime) / fade);
    };
    const ended = () => setPlaying(false);
    a.addEventListener("timeupdate", tick); a.addEventListener("ended", ended);
    return () => { a.removeEventListener("timeupdate", tick); a.removeEventListener("ended", ended); };
  }, []);

  // One place to run a bound key, whether it was pressed in this window or forwarded from the
  // audience one. Returns true if it matched something, so the caller can preventDefault.
  const runKey = (key: string) => {
    const action = (Object.keys(binds) as Action[]).find(a => binds[a] === key); if (!action) return false;
    if ((action === "nextCue" || action === "prevCue" || action === "nextVisual" || action === "prevVisual") && !selectedSequence) return false;
    if ((action === "zoomIn" || action === "zoomOut") && !stage) return false;
    if (["volUp", "volDown", "speedUp", "speedDown", "reverbUp", "reverbDown"].includes(action) && !selected) return false;
    // Nothing to play or pause on a still image, and swallowing the key would only look broken.
    if (action === "playPause" && !voices.current.playing().length && (!selected || isVisual(selected))) return false;
    switch (action) {
      case "nextCue": advanceAudio(1); break;
      case "prevCue": advanceAudio(-1); break;
      case "nextVisual": advanceVisual(1); break;
      case "prevVisual": advanceVisual(-1); break;
      case "zoomIn": zoomStage(.1); break;
      case "zoomOut": zoomStage(-.1); break;
      case "playPause": pauseOrResume(); break;
      case "stopAll": stopAllSound(); break;
      case "volUp": nudge("volume", .05, 0, 1); break;
      case "volDown": nudge("volume", -.05, 0, 1); break;
      case "speedUp": nudge("speed", .05, .5, 2); break;
      case "speedDown": nudge("speed", -.05, .5, 2); break;
      case "reverbUp": nudge("reverb", .05, 0, 1); break;
      case "reverbDown": nudge("reverb", -.05, 0, 1); break;
    }
    return true;
  };
  /**
   * Same ref indirection as the bus handler below, and for the same reason. This effect had no
   * dependency array, so the listener was removed and re-added on every render -- including the
   * 4 Hz playback ticks and the 10 Hz cue timer -- and a keydown landing between the two was lost.
   * The ref is reassigned per render instead, so the handler still sees current state.
   */
  const armedRef = useRef(false);
  const firePadRef = useRef<(slot: number) => boolean>(() => false);
  const onKeyDown = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyDown.current = e => {
    const el = e.target as HTMLElement; if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
    // Space on a focused button already presses it. Letting the bind through as well fired the cue
    // twice, which on a live deck is a wrong sound and a lost place in the sequence.
    if (el.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    // Number keys are the pads, and only while a deck is armed -- outside a show they are still
    // free for anything else, and inside one they are the fastest control on the desk.
    if (armedRef.current && !e.metaKey && !e.ctrlKey && !e.altKey && /^[0-9]$/.test(e.key)) {
      if (firePadRef.current(e.key === "0" ? 9 : Number(e.key) - 1)) { e.preventDefault(); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (runKey(e.key)) e.preventDefault();
  };
  useEffect(() => {
    const keys = (e: KeyboardEvent) => onKeyDown.current(e);
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
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
  /**
   * A slider drag is one edit, not sixty. Recording history per frame meant two
   * `JSON.stringify(all sequences)` plus a `structuredClone` of them plus a synchronous
   * localStorage write of the whole feature state -- undo stack and run log included -- on every
   * pointermove, during a live show. The frames now only move the value; the undo entry is written
   * once, on release, against the state the drag started from.
   */
  const armedDragFrom = useRef<Sequence[] | null>(null);
  const updateArmedEffects = (fx: Effects) => {
    if (armedAudioItem) {
      armedDragFrom.current ??= sequenceRef.current;
      const next = sequenceRef.current.map(sequence => sequence.id !== sequenceId ? sequence : {
        ...sequence, items: sequence.items.map(item => item.id === armedAudioItem.id ? { ...item, effects: fx } : item),
      });
      sequenceRef.current = next;
      setSequences(next);
    } else updateEffects(fx);
    engine.current.apply(audio.current, fx);
    const sounding = voices.current.playing()[0];
    if (sounding) sounding.engine.apply(sounding.element, fx);
  };
  const commitArmedEffects = () => {
    const before = armedDragFrom.current;
    armedDragFrom.current = null;
    if (before) updateFeatures(state => recordHistory(state, before, sequenceRef.current, "Update armed cue effects"));
  };
  const updateVisual = (visual: Visual) => { if (!selected) return; setTracks(all => patch(all, selected.id, { visual })); setStage(s => s && s.url === selected.url ? { ...s, visual } : s); };
  // A fresh edit invalidates whatever the element has loaded: swap the source and rewind rather than
  // let the transport keep playing the pre-edit audio.
  useEffect(() => {
    if (!editUrl && !wasEditing.current) return;
    wasEditing.current = !!editUrl;
    audio.current.pause(); setPlaying(false);
    audio.current.src = editUrl || selected?.url || "";
    audio.current.currentTime = 0;
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
    const request = ++playRequest.current;
    if (swap) { a.src = src; a.preload = "auto"; a.load(); }
    if (restart || swap) { a.currentTime = 0; }
    try {
      await engine.current.play(a, fx);
      if (request === playRequest.current) setPlaying(true);
    } catch {
      if (request === playRequest.current) setPlaying(false);
    }
  };
  const toggle = () => { if (playing) { audio.current.pause(); setPlaying(false); } else void play(selected, selected?.effects, false); };
  /** Puts a slide or video on the stage. Audio keeps playing under it, which is the whole point. */
  const show = (track: Track, visual = track.visual ?? defaultVisual(), slideIndex?: number) =>
    setStage(s => ({ url: track.url, kind: kindOf(track), visual, label: slideIndex === undefined ? track.title : `${track.title} · Slide ${slideIndex + 1}`, slideIndex, n: (s?.n ?? 0) + 1 }));
  const zoomStage = (delta: number) => setStage(s => s && ({ ...s, visual: { ...s.visual, zoom: clamp(s.visual.zoom + delta, .25, 4) } }));
  // Soundboard: click a card to fire it (and make it the active/editor asset).
  const playTrack = (track: Track) => {
    setSelectedId(track.id);
    if (isVisual(track)) return show(track);
    lastAudioId.current = track.id;
    // A pad that is sounding stops on the second press; anything else starts alongside it, which is
    // what makes the library usable as a soundboard rather than a one-at-a-time preview list.
    const held = voices.current.find(track.id);
    if (held && !held.element.paused) { voices.current.release(held); setVoiceTick(n => n + 1); return; }
    void playVoice(track, track.effects);
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
  const seek = (v: number) => { audio.current.currentTime = v; };
  /** Sends one cue to the room. No index bookkeeping, so a linked partner can go out through it too. */
  const fire = (item: SequenceItem) => {
    const track = trackById.get(item.trackId);
    if (!track) return;
    if (isVisual(track)) show(track, item.visual ?? track.visual ?? defaultVisual(), item.slideIndex);
    else void playVoice(track, item.effects ?? track.effects);
  };
  /** Fires a sound on its own voice. Anything already sounding keeps sounding. */
  const playVoice = async (track: Track, fx = track.effects) => {
    const voice = voices.current.claim(track.id);
    const src = editUrl && track.id === selectedRef.current?.id ? editUrl : track.url;
    if (voice.element.src !== new URL(src, location.href).href) { voice.element.src = src; voice.element.load(); }
    voice.element.currentTime = 0;
    voiceLevel.current.set(voice.id, fx.volume);
    setVoiceTick(n => n + 1);
    try {
      await voice.engine.play(voice.element, fx);
      voice.element.volume = fx.volume * masterRef.current;
    } catch { voices.current.release(voice); }
    setVoiceTick(n => n + 1);
  };
  /**
   * Panic. Every voice stops and the editor's own element with them, but the stage is left alone --
   * killing the sound and blacking the projection are two different emergencies, and an operator
   * reaching for this one usually still wants the audience looking at something.
   */
  const stopAllSound = () => {
    voices.current.stopAll();
    audio.current.pause();
    setPlaying(false);
    setVoiceTick(n => n + 1);
  };
  /**
   * The pads.
   *
   * A cue board is a running order; a soundboard is everything else -- the door slam, the phone
   * ring, the thing the director asks for in the interval. Favourites come first because that is
   * already the operator saying "these are the ones I reach for", and ten to a bank because that is
   * how many number keys a keyboard has above the letters.
   */
  const PADS_PER_BANK = 10;
  const padTracks = useMemo(
    () => scopedTracks.filter(track => !isVisual(track))
      .sort((a, b) => Number(features.favorites.includes(b.id)) - Number(features.favorites.includes(a.id))),
    [scopedTracks, features.favorites],
  );
  const padBanks = Math.max(1, Math.ceil(padTracks.length / PADS_PER_BANK));
  const bank = Math.min(padBank, padBanks - 1);
  const padsShown = padTracks.slice(bank * PADS_PER_BANK, bank * PADS_PER_BANK + PADS_PER_BANK);
  const padsRef = useRef(padsShown); padsRef.current = padsShown;
  /** "1".."9" then "0", the order they sit on the keyboard. */
  const padKey = (slot: number) => String((slot + 1) % 10);
  const firePad = (slot: number) => {
    const track = padsRef.current[slot];
    if (!track) return false;
    const held = voices.current.find(track.id);
    if (held && !held.element.paused) { voices.current.release(held); setVoiceTick(n => n + 1); return true; }
    void playVoice(track, track.effects);
    return true;
  };
  armedRef.current = armed;
  firePadRef.current = firePad;
  /**
   * Which tracks are making a noise right now. Was `playing ? selected.id : ""`, which was already
   * only ever one card and is now wrong outright: cues run on their own voices, so the sound the
   * room can hear is often not the track the editor has open.
   */
  const soundingIds = useMemo(
    () => voices.current.playing().map(voice => voice.trackId!).concat(playing && selected && !isVisual(selected) ? [selected.id] : []),
    [voiceTick, playing, selected?.id],
  );

  /** The voice a transport control acts on: whatever went out most recently and is still sounding. */
  const liveVoice = () => voices.current.playing()[0] ?? voices.current.all().find(v => v.trackId) ?? null;
  const pauseOrResume = () => {
    const voice = liveVoice();
    if (!voice) { toggle(); return; }
    if (voice.element.paused) void voice.element.play().catch(() => undefined);
    else voice.element.pause();
    setVoiceTick(n => n + 1);
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
    sendShow({ type: "cue", index: i, label: cueLabels[i] ?? String(i + 1) });
    if (armed && !loopSeq && i === selectedSequence.items.length - 1) {
      const ids = showSequenceIds();
      const next = sequences.find(sequence => sequence.id === ids[ids.indexOf(selectedSequence.id) + 1]);
      if (next && armSequence(next, false)) toast("Next sequence armed", `${next.name} is ready to run.`, "success");
    }
  };

  /**
   * What the room is allowed to know: the sequence as labels, and the script. No source URLs
   * for sounds, because a device that only reads cues has no business being able to download them.
   */
  const cueLabels = useMemo(
    () => selectedSequence ? cueNumbers(selectedSequence.items.map(it => kindOf(trackById.get(it.trackId) ?? { kind: "audio" }))) : [],
    [selectedSequence, trackById],
  );
  /**
   * The deck as one member is allowed to see it.
   *
   * Cues and the stage were always broadcast. The script was too -- to anybody who sent `here`,
   * which is anybody holding the show id. Now it goes only to a member the server says holds
   * `script`, and the message names who it is for. Broadcast is still broadcast, so another device
   * already in the channel could read a payload addressed to someone else; this narrows who is
   * *sent* the script, not who could intercept it. Per-member delivery needs the server.
   */
  const deck = (to: string | undefined, perms: Perm[]): ShowMsg => {
    const may = (p: Perm) => perms.includes(p);
    return {
      type: "deck",
      to,
      show: selectedSequence?.name ?? "Show",
      sequence: selectedSequence?.id ?? "",
      index: cueIndex,
      cues: may("cues") ? (selectedSequence?.items ?? []).map((it, i) => ({
        id: it.id, label: it.label, number: cueLabels[i] ?? String(i + 1),
        kind: kindOf(trackById.get(it.trackId) ?? { kind: "audio" }),
      })) : [],
      script: may("script") && scriptDoc.html.length <= SCRIPT_LIMIT ? scriptDoc.html : undefined,
      stage: may("stage") && stage ? { url: stage.url, kind: stage.kind, label: stage.label, slideIndex: stage.slideIndex } : null,
    };
  };
  /** What goes out when the host does not yet know who is listening: no script, ever. */
  const PUBLIC_DECK: Perm[] = ["cues", "stage"];
  const resendDeck = () => {
    if (!liveShow) return;
    const seen = [...roster.current.entries()];
    if (!seen.length) { sendShow(deck(undefined, PUBLIC_DECK)); return; }
    for (const [member, who] of seen) sendShow(deck(member, who.perms));
  };
  const resendRef = useRef(resendDeck); resendRef.current = resendDeck;
  /**
   * The deck used to resend on `[stage.n, liveShow.id]` alone, so renaming a cue, reordering the
   * sequence or loading a script left every crew device quietly holding a stale list all night.
   * Signature over what the room can actually see, so a resend happens when their copy is wrong and
   * not on every keystroke in the studio.
   */
  const deckSignature = useMemo(
    () => JSON.stringify([selectedSequence?.id, selectedSequence?.name, (selectedSequence?.items ?? []).map(it => [it.id, it.label, it.trackId]), cueLabels]),
    [selectedSequence, cueLabels],
  );
  useEffect(() => {
    if (!liveShow || !showLink.ready) return;
    const timer = setTimeout(() => resendRef.current(), 200);
    return () => clearTimeout(timer);
  }, [deckSignature, scriptDoc.html, stage?.n, liveShow?.id, showLink.ready]);

  /**
   * Nothing the room says is acted on until the server confirms the sender may say it.
   *
   * Perms used to decide which buttons a crew device drew and nothing else: the host ran any `fire`,
   * `relabel` or `flash` that arrived, from anyone who knew the show id. `memberPerms` asks the same
   * RPC the door does, so a job whose key was revoked stops being able to call cues here too.
   */
  const onCrewMsg = async (msg: Extract<ShowMsg, { member: string }>, show: Show) => {
    const perms = await memberPerms(msg.member, show.id);
    if (!perms.length) return;
    if (msg.type === "here") {
      const who = { name: msg.who, role: msg.role, perms, at: Date.now() };
      roster.current.set(msg.member, who);
      setMembers([...roster.current.entries()].map(([member, m]) => ({ member, name: m.name, role: m.role, perms: m.perms })));
      sendShow(deck(msg.member, perms));
      toast("Someone joined", `${msg.role ?? msg.who ?? "A device"} is in the show.`, "info");
      return;
    }
    if (msg.type === "fire") {
      if (!perms.includes("fire")) return;
      // Pinned to the sequence the crew device is actually looking at. Without this, an operator who
      // switched sequences turned a crew "Go" on cue 4 into whatever now sits at position 4.
      if (msg.sequence && msg.sequence !== selectedSequence?.id) {
        toast("Cue not fired", `${msg.from} called a cue from a different sequence.`, "warn");
        return;
      }
      playCue(msg.index);
      return;
    }
    if (msg.type === "flash") { if (perms.includes("message")) showAlert("warn", msg.text); return; }
    if (msg.type === "relabel") {
      if (!perms.includes("edit")) return;
      setSequences(all => all.map(s => s.id !== sequenceId ? s : ({
        ...s, items: s.items.map(it => (it.id === msg.id ? { ...it, label: msg.label } : it)),
      })));
    }
  };
  onShowMsg.current = msg => {
    // A collaborator holds the show password, so calling the show on is theirs to do as well. The
    // host's copy is still the one that gets written down.
    if (msg.type === "start" && liveShow) { setLiveShow({ ...liveShow, startedAt: msg.at }); void updateShow(liveShow.id, { started_at: msg.at }); return; }
    if (msg.type === "end" && liveShow) { setLiveShow({ ...liveShow, startedAt: null }); void updateShow(liveShow.id, { started_at: null }); return; }
    if (liveShow && "member" in msg) void onCrewMsg(msg, liveShow);
  };
  /** Both sides hold the link, and each cue has at most one partner, so an old pairing is dropped. */
  const linkCues = (aId: string, bId: string) => applySequences(all => all.map(s => s.id !== sequenceId ? s : ({
    ...s, items: linkSequenceItems(s.items, aId, bId),
  })), "Link cues");
  const unlinkCue = (id: string) => applySequences(all => all.map(s => s.id !== sequenceId ? s : ({
    ...s, items: unlinkSequenceItem(s.items, id),
  })), "Unlink cues");
  const showSequenceIds = () => {
    if (!liveShow) return [] as string[];
    const linked = linksOf(links, liveShow.id).seqs;
    return [...new Set([liveShow.sequenceId, ...linked].filter((id): id is string => !!id))];
  };
  const armSequence = (seq: Sequence, clearStage = true) => {
    if (!seq.items.length) return false;
    setSequenceId(seq.id); setTab("sequence"); setCueIndex(-1); setArmed(true); audio.current.pause(); setPlaying(false);
    if (clearStage) setStage(null);
    updateFeatures(state => ({ ...state, runHistory: [...state.runHistory, { id: crypto.randomUUID(), at: new Date().toISOString(), type: "start" as const, sequenceId: seq.id, sequenceName: seq.name }].slice(-500) }));
    return true;
  };
  const advance = (dir: 1 | -1) => {
    if (!selectedSequence) return;
    const n = selectedSequence.items.length; if (!n) return;
    if (dir === 1 && !loopSeq && cueIndex >= n - 1) {
      const ids = showSequenceIds();
      const nextId = ids[ids.indexOf(sequenceId) + 1];
      const next = sequences.find(s => s.id === nextId);
      if (next && armSequence(next, false)) { toast("Next sequence armed", `${next.name} is ready to run.`, "success"); return; }
      return;
    }
    const i = loopSeq ? (cueIndex + dir + n) % n : clamp(cueIndex + dir, 0, n - 1);
    playCue(i);
  };
  /**
   * How long the current cue holds, or 0 for "no timer". The countdown itself lives in its own leaf
   * component: ticking it here meant `setTimerLeft` re-rendered all 1600 lines of Studio ten times a
   * second to update one `<span>`, and the `features.cueTimers` dependency -- a fresh object on
   * every unrelated feature write -- restarted the interval each time as well.
   */
  const countdownSeconds = (() => {
    if (!armed || !selectedSequence || cueIndex < 0) return 0;
    const item = selectedSequence.items[cueIndex];
    const seconds = Number(item ? features.cueTimers[item.id] ?? 0 : 0);
    if (!seconds || (!loopSeq && cueIndex >= selectedSequence.items.length - 1)) return 0;
    return seconds;
  })();
  /** Arrow keys step audio cues only, so visual slides can be advanced independently with WASD. */
  const advanceAudio = (dir: 1 | -1) => {
    const items = selectedSequence?.items ?? []; if (!items.length) return;
    for (let step = 1; step <= items.length; step++) {
      const i = loopSeq ? (cueIndex + dir * step + items.length * step) % items.length : cueIndex + dir * step;
      if (i < 0 || i >= items.length) break;
      const track = trackById.get(items[i]?.trackId ?? "");
      if (track && !isVisual(track)) return playCue(i);
    }
  };
  /** WASD steps the deck's visuals only, so slides move without disturbing the sound already running. */
  const advanceVisual = (dir: 1 | -1) => {
    const items = selectedSequence?.items ?? []; if (!items.length) return;
    const visualAt = (i: number) => { const t = trackById.get(items[i]?.trackId ?? ""); return t && isVisual(t); };
    for (let step = 1; step <= items.length; step++) {
      const i = loopSeq ? (cueIndex + dir * step + items.length * step) % items.length : cueIndex + dir * step;
      if (i < 0 || i >= items.length) break;
      if (visualAt(i)) return playCue(i);
    }
  };
  const nudge = (key: keyof Effects, delta: number, min: number, max: number) => {
    if (!selected) return;
    const base = armed ? armedEffects : selected.effects;
    const next = { ...base, [key]: clamp(Number(base[key]) + delta, min, max) };
    if (armed) updateArmedEffects(next); else updateEffects(next);
  };
  // Arms the deck without firing anything: cue 1 waits for the first arrow press, so nothing ever
  // hits the room the moment a window opens.
  // A phone has no arrow keys, so the armed lesson would be teaching a control that is not there:
  // narrow screens get the docked transport explained instead. One lesson per arming, either way.
  // `seq` defaults to the open one, and is passed when a sequence is run straight from the rail or
  // from the show manager: one sequence on its own, in a show or outside one, is the same arming.
  const startSequence = (audience: boolean, seq = selectedSequence) => {
    teach(matchMedia("(max-width: 1023px)").matches ? "transport" : "armed");
    if (!seq?.items.length) return;
    if (audience) openAudience();
    armSequence(seq);
  };
  /** From the manager: leave the show's screen, arm that sequence, put it up in presenter mode. */
  const runSequence = (seqId: string) => { setManaging(false); startSequence(true, sequences.find(s => s.id === seqId)); };
  const armShowSequence = (seqId: string) => { const seq = sequences.find(s => s.id === seqId); if (seq) { teach(phone ? "transport" : "armed"); armSequence(seq); } };
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
    created.forEach((t, i) => {
      const file = files[i];
      const slideMeta = t.kind !== "embed" ? Promise.resolve<DeckSlide[] | undefined>(undefined)
        : file.name.toLowerCase().endsWith(".pptx") ? slidesFromPptx(file).catch(() => slideLabels(1))
        : Promise.resolve(slideLabels(1));
      void slideMeta.then(slides => {
        if (slides) setTracks(o => patch(o, t.id, { slides }));
        return uploadTrack(file);
      }).then(url => { setTracks(o => patch(o, t.id, { url, pending: false })); URL.revokeObjectURL(t.url); })
        .catch(() => setTracks(o => patch(o, t.id, { pending: false, error: true })));
    });
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
    if (chosen.some(track => track.slides?.length)) teach("mixed-media");
    const items = chosen.flatMap(t => {
      const slides = t.kind === "embed" && t.slides?.length ? t.slides : [undefined];
      return slides.map(slide => ({
        id: crypto.randomUUID(), trackId: t.id, label: slide ? `${t.title} · ${slide.label}` : t.title,
        effects: cloneEffects(t.effects), ...(isVisual(t) ? { visual: { ...(t.visual ?? defaultVisual()) } } : {}),
        ...(slide ? { slideIndex: slide.index } : {}),
      }));
    });
    applySequences(o => o.map(s => s.id !== seqId ? s : { ...s, items: [...s.items, ...items] }), "Add cue to sequence");
    toast("Added to the sequence", `${chosen.length} item${chosen.length === 1 ? "" : "s"} into ${sequences.find(s => s.id === seqId)?.name ?? "it"}.`, "success");
  };
  const addItem = () => addTracksTo(sequenceId, selectedIds.length ? selectedIds : selected ? [selected.id] : []);
  const linkAudioToSlide = (deckId: string, slideIndex: number) => {
    teach("cue-links");
    const audioTrack = tracks.find(track => track.id === lastAudioId.current) ?? tracks.find(track => track.id === selectedId && !isVisual(track));
    const deckTrack = tracks.find(track => track.id === deckId);
    if (!audioTrack || isVisual(audioTrack) || deckTrack?.kind !== "embed") return toast("Select an audio cue first", "Choose an audio item, then link it to a presentation slide.", "info");
    if (!sequenceId) return toast("Choose a sequence first", "The linked audio and slide will be added to the selected sequence.", "info");
    const slide = deckTrack.slides?.find(item => item.index === slideIndex);
    if (!slide) return toast("Slide unavailable", "This presentation does not expose that slide yet.", "warn");
    const audioItemId = crypto.randomUUID();
    const slideItemId = crypto.randomUUID();
    applySequences(all => all.map(sequence => {
      if (sequence.id !== sequenceId) return sequence;
      const existingAudio = sequence.items.find(item => item.trackId === audioTrack.id);
      const existingSlide = sequence.items.find(item => item.trackId === deckTrack.id && item.slideIndex === slideIndex);
      const audioItem = existingAudio ?? { id: audioItemId, trackId: audioTrack.id, label: audioTrack.title, effects: cloneEffects(audioTrack.effects) };
      const slideItem = existingSlide ?? { id: slideItemId, trackId: deckTrack.id, label: `${deckTrack.title} · ${slide.label}`, slideIndex, effects: cloneEffects(deckTrack.effects), visual: { ...(deckTrack.visual ?? defaultVisual()) } };
      const items = [...sequence.items];
      if (!existingAudio) items.push(audioItem);
      if (!existingSlide) items.push(slideItem);
      return { ...sequence, items: items.map(item => item.id === audioItem.id || item.id === slideItem.id ? { ...item, link: item.id === audioItem.id ? slideItem.id : audioItem.id } : item) };
    }), "Link audio to presentation slide");
    toast("Audio linked", `${audioTrack.title} fires with ${deckTrack.title} · ${slide.label}.`, "success");
  };
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
    if (phone && where !== "off") setPane("script");
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

  const hasMobilePlayer = phone && !!selected && !isVisual(selected) && !editingId && !armed;
  return (
    <Shell>
      {/* The working surface, and the only thing the dark toggle reaches: the sidebar, the nav and
          the footer around it stay beige, and so does everybody else's device. */}
      <WorkSurface className={`-mx-3 rounded-2xl px-3 py-4 ${hasMobilePlayer ? "pb-40 sm:pb-4" : ""}`}>
      {alertScope === "operator" && <AlertFlash level={flash} scope="operator" />}
      {/* The alert's own words, held on screen after the flash has gone: a flash you half-caught
          while looking at the deck is no use if it does not say what it was for. */}
      <AnimatePresence mode="wait">
        {alertNote && (
          <motion.div key={alertNote} initial={{ y: -10, opacity: 0, scale: .96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -8, opacity: 0, scale: .98 }} transition={{ type: "spring", stiffness: 340, damping: 24 }} className={`pointer-events-none fixed inset-x-0 top-16 z-50 mx-auto w-fit rounded-full border px-4 py-1.5 text-sm font-semibold shadow-glass ${flash === "hit" ? "border-live/50 bg-live/20" : "border-armed/50 bg-armed/20"}`}>
            {alertNote}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Bottom padding clears the fixed player, which stacks taller on phones, and on a phone the
          pane bar below it as well. */}
      <div className="pb-56 sm:pb-36">
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
            <Button size="sm" variant="light" startContent={<Upload size={15} aria-hidden />} as="label">Import<input className="sr-only" type="file" accept="application/json,.json" aria-label="Import a project backup" onChange={importFile} /></Button>
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
            <CueTransport element={liveVoice()?.element ?? null} label={liveVoice()?.trackId ? (trackById.get(liveVoice()!.trackId!)?.title ?? "the cue") : "the cue"}
              onToggle={pauseOrResume} onStop={stopAllSound} master={master} setMaster={setMaster} commitMaster={commitMaster} />
            <span className="ml-auto flex items-center gap-1">
              <Button data-coach="presenter" size="sm" variant="flat" startContent={<Monitor size={15} />} onPress={openAudience}>Audience display</Button>
              <Button data-coach="script" size="sm" variant="flat" startContent={<FileText size={15} />} onPress={() => openScript("split")}>Open script</Button>
              <CoachHelp id="armed" />
            </span>
          </div>
        )}

        {armed && (
          <section className="mt-3" aria-label="Soundboard">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="light" aria-expanded={padsOpen} onPress={() => setPadsOpen(open => !open)}
                startContent={padsOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}>
                Soundboard
              </Button>
              {padsOpen && padBanks > 1 && (
                <span className="flex items-center gap-1 text-xs text-muted">
                  {Array.from({ length: padBanks }, (_, index) => (
                    <Button key={index} size="sm" variant={index === bank ? "flat" : "light"} aria-pressed={index === bank}
                      aria-label={`Pad bank ${index + 1}`} onPress={() => setPadBank(index)}>{index + 1}</Button>
                  ))}
                </span>
              )}
            </div>
            {padsOpen && (padsShown.length ? (
              <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {padsShown.map((track, slot) => {
                  const voice = voices.current.find(track.id);
                  const sounding = !!voice && !voice.element.paused;
                  return (
                    <li key={track.id}>
                      <button type="button" onClick={() => firePad(slot)}
                        aria-pressed={sounding}
                        title={`${track.title} — press ${padKey(slot)}`}
                        className={`flex h-16 w-full flex-col items-start justify-between rounded-xl border px-2.5 py-2 text-left transition-colors ${sounding ? "border-live bg-live/20" : "border-border bg-surface/50 hover:border-accent"}`}>
                        <span className="flex w-full items-center justify-between gap-2">
                          <kbd className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-muted">{padKey(slot)}</kbd>
                          {sounding && <span aria-hidden className="h-2 w-2 rounded-full bg-live" />}
                        </span>
                        <span className="w-full truncate text-xs font-semibold">{track.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-2 text-sm text-muted">No sounds in this project yet.</p>)}
          </section>
        )}

        {/* Above the tabs: the shows, and beside them the script. Both go away while a library item
            is selected -- the toolbar takes their place -- and while a deck is armed. */}
        {!armed && !editingId && !picked.length && (!phone || pane === "shows") && (
          <ShowsBoard shows={shows} links={links} sequences={sequences} script={scriptDoc.html ? scriptDoc : null}
            showsGrid={showsGrid} scriptGrid={scriptGrid} loading={showsLoading} busy={!signedIn} over={seqDrag.over}
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
              {features.templates.length > 0 && <Select aria-label="Create from template" value="" size="sm" className="min-w-40"
                onChange={value => { if (value) createFromTemplate(value); }}
                options={[{ value: "", label: "From template…" }, ...features.templates.map(template => ({ value: template.id, label: template.name }))]} />}
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
                  <li key={s.id} data-drop={`seq:${s.id}`} onContextMenu={(event: ReactMouseEvent) => { event.preventDefault(); setSequenceMenuFor(s.id); }}
                    className={`group relative flex items-center gap-1 rounded-full border pr-1 transition-colors ${sequenceMenuFor === s.id ? "z-30" : "z-0"} ${libDrag.over === `seq:${s.id}` ? "border-accent bg-accent/25" : s.id === sequenceId ? "border-accent bg-accent/15" : "border-border bg-surface/50"}`}>
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
                    <ShareButton iconOnly label={`Share ${s.name}`} url={studioShareUrl({ tab: "sequence", seq: s.id })} title={`${s.name} · CueFlow sequence`} text={`Open the ${s.name} sequence in CueFlow`} />
                    <div className="relative">
                      <Button isIconOnly size="sm" variant="light" className="sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100" aria-label={`More actions for ${s.name}`} title="More actions" onPress={() => setSequenceMenuFor(sequenceMenuFor === s.id ? null : s.id)}><MoreHorizontal size={13} /></Button>
                      {sequenceMenuFor === s.id && <div className="absolute right-0 top-full z-40 mt-1 flex w-40 flex-col gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-glass">
                        <Button size="sm" variant="light" className="justify-start" onPress={() => { setSequenceMenuFor(null); duplicateSequence(s); }}><Copy size={14} />Duplicate</Button>
                        <Button size="sm" variant="light" className="justify-start" onPress={() => { setSequenceMenuFor(null); openRename("sequence", s.id, s.name); }}><Pencil size={14} />Rename</Button>
                        <Button size="sm" variant="light" color="danger" className="justify-start" onPress={() => { setSequenceMenuFor(null); deleteSequence(s.id); }}><Trash2 size={14} />Delete</Button>
                      </div>}
                    </div>
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
            <Select aria-label="Add to sequence" value="" size="sm" className="min-w-40"
              onChange={value => { if (value) addTracksTo(value, picked); }}
              options={[{ value: "", label: "Add to sequence…" }, ...sequences.map(s => ({ value: s.id, label: s.name }))]} />
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
            onSelectionChange={k => {
              setTab(k as string);
              teach(k as "library" | "sequence");
              // `waveforms` had no trigger anywhere in the app, so a written lesson was simply never
              // shown. The coach runs one at a time and does not mark the loser learned, so this
              // queues behind the library lesson rather than stacking on it.
              if (k === "library" && scopedTracks.some(track => !isVisual(track))) teach("waveforms");
            }}
            classNames={{ tabList: armed || phone ? "hidden" : "glass-soft" }}>
            <Tab key="library" id="library" title={<span className="flex items-center gap-2"><Layers size={16} />Library</span>}>
              <Library tracks={shownTracks} total={scopedTracks.length} selectedId={selected?.id ?? ""} playingIds={soundingIds} selectedIds={selectedIds} busy={busy} drag={libDrag} onPlay={playTrack} onToggleSelect={toggleSelect} onAdd={addFiles} onAddSlide={() => setSlideOpen(true)} onOpenEditor={openEditor} onLinkSlide={linkAudioToSlide} onRename={(id: string) => { const t = tracks.find(x => x.id === id); if (t) openRename("track", id, t.title); }} onDeleteTrack={deleteTrack} importAsset={importAsset} query={libQuery} setQuery={setLibQuery} sort={libSort} setSort={setLibSort} kind={libKind} setKind={setLibKind} favorites={features.favorites} collections={features.collections} scope={libScope} setScope={setLibScope} onNewCollection={newCollection} onToggleFavorite={(id: string) => updateFeatures(state => toggleFavorite(state, id))} onAddToCollection={addToNamedCollection} />
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
            <Select data-coach="script" aria-label="Where the reader sits" value={scriptMode} className="mb-2 w-full"
              onChange={value => openScript(value as typeof scriptMode)}
              options={[{ value: "split", label: "Reader: split screen" }, { value: "popup", label: "Reader: popup window" }, { value: "tab", label: "Reader: new tab" }, { value: "off", label: "Close the reader" }]} />
            {/* BroadcastChannel never echoes to the window that posted, so this one raises its own. */}
            <ScriptReader doc={scriptDoc} setDoc={setScriptDoc} alertScope={alertScope}
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
              <button key={p.id} type="button" data-tour={`pane-${p.id}`} aria-current={on} onPointerDown={(event) => event.preventDefault()} onClick={() => setPane(p.id)}
                className={`flex min-h-14 touch-manipulation flex-col items-center justify-center gap-1 pt-2 text-[11px] font-semibold transition-colors ${on ? "text-accent" : "text-muted"}`}>
                <p.icon size={19} aria-hidden />
                {p.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* Hidden in the editor: that tab has its own transport, and three play buttons on one screen
          is two too many. Visual assets have no transport at all. Armed mode owns this responsive
          transport on every viewport: phones get the large tap targets, desktop keeps the same
          controls beside the keyboard-driven deck. */}
      {armed && (
        // Above the sign-in nudge and anything else that docks itself down here: while a deck is
        // armed, nothing gets to sit on top of the next-cue button.
        <div data-coach="transport" className="fixed inset-x-0 bottom-0 z-50 max-h-[58dvh] overflow-y-auto border-t border-white/10 bg-background/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:inset-x-4 lg:bottom-4 lg:mx-auto lg:max-w-[1080px] lg:rounded-2xl lg:border lg:p-4 lg:pb-4 lg:shadow-glass">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="flex min-w-0 items-center gap-3 lg:shrink-0">
              <Button className="h-16 w-24 shrink-0 text-base" variant="flat" onPress={() => advance(-1)}>← Back</Button>
              {/* The one thing this screen exists to do, so it is the biggest thing on it. */}
              <Button data-coach="fire" className="h-16 min-w-0 flex-1 text-lg font-bold lg:w-40 lg:flex-none" color="primary" onPress={() => advance(1)}>
                {cueIndex < 0 ? "Fire cue 1" : "Next cue →"}
              </Button>
              {countdownSeconds > 0 && <CueCountdown seconds={countdownSeconds} cueKey={`${selectedSequence?.id ?? ""}:${cueIndex}`} onElapsed={() => advance(1)} />}
              {features.rehearsal.active && <span className="shrink-0 rounded-xl border border-live/40 bg-live/10 px-2 py-1 text-xs text-live">Rehearsal</span>}
              <CoachHelp id="transport" />
            </div>
            <ArmedEffectControls effects={armedEffects} update={updateArmedEffects} commit={commitArmedEffects} />
          </div>
        </div>
      )}

      <AnimatePresence>{selected && !isVisual(selected) && !editingId && !armed && <Player key={`player-${selected.id}`} track={selected} unsaved={!!editUrl} playing={playing} toggle={toggle} audio={audio.current} seek={seek} jump={jump} loop={loop} setLoop={setLoop} effects={selected.effects} update={updateEffects} />}</AnimatePresence>

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
          onFlash={text => { sendShow({ type: "flash", text, from: "host", member: "host" }); showAlert("warn", text); }}
          onResend={resendDeck}
          onAddSequence={seqId => sequenceToShow(seqId, liveShow.id)} onAddScript={() => scriptToShow(liveShow.id)}
          onRunSequence={runSequence} onStage={t => show(t)}
          onAddToSequence={(seqId, trackId) => addTracksTo(seqId, [trackId])}
          onFire={playCue} onArmSequence={armShowSequence} onOpenAudience={openAudience} />
      )}

      <SlideComposer open={slideOpen} onClose={() => setSlideOpen(false)} onCreate={addProcessedFile} />
      </WorkSurface>
    </Shell>
  );
}

function Library({ tracks, total, selectedId, playingIds, selectedIds, busy, drag, onPlay, onToggleSelect, onAdd, onAddSlide, onOpenEditor, onLinkSlide, onRename, onDeleteTrack, importAsset, query, setQuery, sort, setSort, kind, setKind, favorites = [], collections = {}, scope = "", setScope, onNewCollection, onToggleFavorite, onAddToCollection }: any) {
  const shown: Track[] = tracks;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const device = useDeviceCapabilities();
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);
  const hoverPreview = device.canHover && device.hasFinePointer && !device.isTouch;
  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Soundboard and slides</p><h2 className="flex items-center gap-1 text-xl font-bold">Click a card to fire it<CoachHelp id="library" /></h2></div>
        <div className="flex flex-wrap gap-2">
          <Tooltip content="A blank 16:9 slide you can put a title on"><Button variant="bordered" isDisabled={busy} startContent={<Presentation size={16} />} onPress={onAddSlide}>New slide</Button></Tooltip>
          <Tooltip content="Audio, images and video from this device"><Button data-coach="add" as="label" color="primary" startContent={<Upload size={17} aria-hidden />}>Upload<input className="sr-only" type="file" accept={UPLOAD_ACCEPT} multiple aria-label="Upload audio, images and video from this device" onChange={onAdd} /></Button></Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Library view" value={scope} onChange={value => setScope?.(value)} size="sm"
          options={[{ value: "", label: "All library items" }, { value: "favorites", label: "Favorites" }, ...Object.keys(collections).map(name => ({ value: name, label: name }))]} />
        <Button size="sm" variant="light" startContent={<FolderPlus size={14} />} onPress={onNewCollection}>New collection</Button>
      </div>
      <SearchBar query={query} setQuery={setQuery} sort={sort} setSort={setSort} kinds={["audio", "image", "video", "embed"]} kind={kind} setKind={setKind} placeholder="Search the library" />
      <SearchPanel importAsset={importAsset} />

      {shown.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid place-items-center rounded-2xl border border-dashed border-border py-16 text-center">
          <LogoMark size={40} className="opacity-45" />
          <p className="mt-3 font-semibold">{total ? "Nothing matches that" : "Nothing here yet"}</p>
          <p className="text-sm text-muted">{total ? "Clear the search to see everything." : "Upload audio, images or video, or search the free libraries above."}</p>
        </motion.div>
      ) : (
        <motion.div layout className="auto-grid">
          <AnimatePresence>{shown.map((t: Track, i: number) => {
            const isPlaying = (playingIds as string[]).includes(t.id), pick = selectedIds.indexOf(t.id), isChecked = pick >= 0;
            const kind = kindOf(t), Icon = kindIcon[kind];
            return (
            <motion.div key={t.id} layout initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} transition={{ delay: Math.min(i * .03, .3) }} whileHover={hoverPreview ? { y: -3 } : undefined}>
              <Card data-tour={i === 0 ? "library-card" : undefined} data-playing={isPlaying ? "true" : undefined} isPressable onPress={() => { setMenuFor(null); onPlay(t); }} onContextMenu={(event: ReactMouseEvent) => { event.preventDefault(); setMenuFor(t.id); }} className={`group media-card media-card--${kind} relative z-0 w-full border ${menuFor === t.id ? "z-20" : ""} ${isPlaying ? "border-accent bg-accent/15" : selectedId === t.id ? "border-accent/60 bg-accent/5" : "border-border bg-surface/60"} ${t.pending ? "opacity-70" : ""}`}>
                <TrackPreview track={t} kind={kind} playOnHover={hoverPreview} onLinkSlide={onLinkSlide} />
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
                      <ShareButton iconOnly label={`Share ${t.title}`} url={studioShareUrl({ tab: "library", track: t.id })} title={`${t.title} · CueFlow`} text={`Open ${t.title} in CueFlow`} />
                      <div className="relative">
                        <Button isIconOnly size="sm" variant="light" className="sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100" aria-label={`More actions for ${t.title}`} title="More actions" onPress={() => setMenuFor(menuFor === t.id ? null : t.id)}><MoreHorizontal size={14} /></Button>
                        {menuFor === t.id && <div className="absolute right-0 top-full z-40 mt-1 flex w-44 flex-col gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-glass">
                          <Button size="sm" variant="light" className="justify-start" onPress={() => { setMenuFor(null); onToggleFavorite?.(t.id); }}><Star size={14} />{favorites.includes(t.id) ? "Remove favorite" : "Favorite"}</Button>
                          <Button size="sm" variant="light" className="justify-start" onPress={() => { setMenuFor(null); onAddToCollection?.(t.id); }}><FolderPlus size={14} />Add to collection</Button>
                          <Button size="sm" variant="light" className="justify-start" onPress={() => { setMenuFor(null); onOpenEditor(t.id); }}><SlidersHorizontal size={14} />Open editor</Button>
                          <Button size="sm" variant="light" className="justify-start" onPress={() => { setMenuFor(null); onRename(t.id); }}><Pencil size={14} />Rename</Button>
                          <Button size="sm" variant="light" color="danger" className="justify-start" onPress={() => { setMenuFor(null); if (confirm(`Delete ${t.title}?`)) onDeleteTrack?.(t.id); }}><Trash2 size={14} />Delete</Button>
                        </div>}
                      </div>
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

function TrackPreview({ track, kind, playOnHover, onLinkSlide }: { track: Track; kind: Kind; playOnHover: boolean; onLinkSlide?: (deckId: string, slideIndex: number) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const enter = () => {
    if (kind !== "video" || !playOnHover) return;
    void video.current?.play().catch(() => {});
  };
  const leave = () => {
    if (!video.current) return;
    video.current.pause();
    video.current.currentTime = 0;
  };
  const cls = "media-preview w-full overflow-hidden bg-surface-secondary";
  if (kind === "image") return <div className={cls}><img src={track.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /></div>;
  if (kind === "video") return <div className={cls} onPointerEnter={enter} onPointerLeave={leave}><video ref={video} src={track.url} muted playsInline preload="metadata" className="h-full w-full object-cover" /></div>;
  if (kind === "embed") return <DeckPreview track={track} className={cls} playOnHover={playOnHover} onLinkSlide={onLinkSlide} />;
  return <div className={`${cls} media-preview-audio`}><AudioPreview url={track.url} title={track.title} /></div>;
}

function DeckPreview({ track, className, playOnHover, onLinkSlide }: { track: Track; className: string; playOnHover: boolean; onLinkSlide?: (deckId: string, slideIndex: number) => void }) {
  const slides = track.slides?.length ? track.slides : [{ index: 0, label: "First slide" }];
  /**
   * Collapsed until asked. Every slide is a live Office Online iframe, and this defaulted to open on
   * any device without hover -- so a forty-slide deck opened forty iframes the moment a tablet
   * scrolled past the card. Hover still expands it on a desktop; touch gets a button instead.
   */
  const [expanded, setExpanded] = useState(false);
  const [contextSlide, setContextSlide] = useState<number | null>(null);
  const officeSource = /\.pptx?($|[?#])/i.test(track.url) && !track.url.startsWith("blob:")
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(track.url)}`
    : track.url;
  const slideUrl = (index: number) => `${officeSource}${officeSource.includes("?") ? "&" : "?"}slide=${index + 1}#slide=${index + 1}`;
  const shown = expanded ? slides : slides.slice(0, 1);
  return (
    <div data-coach="ppt-slides" className={`${className} media-preview-deck overflow-y-auto p-2`} onPointerEnter={() => { if (playOnHover) { setExpanded(true); teach("ppt-slides"); } }} onPointerLeave={() => { if (playOnHover) setExpanded(false); }}>
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map(slide => (
          <div key={slide.index} className="group/slide relative overflow-hidden rounded-lg border border-border bg-background/70" onPointerDown={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); setContextSlide(slide.index); }}>
            <div className="aspect-video bg-black/30">
              <iframe src={slideUrl(slide.index)} title={`${track.title}, ${slide.label}`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full border-0" />
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate font-control text-xs">{slide.label}</span>
              {onLinkSlide && <Button data-coach="cue-links" size="sm" variant="light" className="shrink-0 text-[11px]" onPress={() => onLinkSlide(track.id, slide.index)}>Link audio</Button>}
            </div>
            {contextSlide === slide.index && onLinkSlide && <div role="menu" className="absolute right-2 top-2 z-20 flex w-36 flex-col gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-glass" onClick={event => event.stopPropagation()}><Button size="sm" variant="light" className="justify-start" onPress={() => { setContextSlide(null); onLinkSlide(track.id, slide.index); }}>Link audio</Button><Button size="sm" variant="light" className="justify-start" onPress={() => setContextSlide(null)}>Close</Button></div>}

          </div>
        ))}
      </div>
      {!playOnHover && slides.length > 1 && (
        <Button size="sm" variant="light" className="mt-2 w-full text-xs" onPress={() => { setExpanded(open => !open); if (!expanded) teach("ppt-slides"); }}>
          {expanded ? "Show first slide only" : `Show all ${slides.length} slides`}
        </Button>
      )}
    </div>
  );
}

function AudioPreview({ url, title }: { url: string; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  /**
   * Only draw what someone can see. Every audio card used to fetch and fully PCM-decode its file the
   * moment the library mounted, so opening a library of thirty sounds decoded thirty sounds. The
   * observer disconnects on the first intersection: a waveform, once drawn, does not need redrawing.
   */
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !visible) return;
    let cancelled = false;
    void decodeAudioUrl(url).then(buffer => {
      if (cancelled || !el.isConnected) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(40, Math.round(rect.width));
      const height = Math.max(24, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.round(width * dpr); el.height = Math.round(height * dpr);
      const ctx = el.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const style = getComputedStyle(el);
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, style.getPropertyValue("--cue-armed").trim() || "#D4A957");
      gradient.addColorStop(1, style.getPropertyValue("--cue-forest").trim() || "#285B43");
      ctx.fillStyle = gradient;
      const values = peaks(buffer, 0, 0, buffer.duration, Math.max(16, Math.floor(width / 2)));
      const mid = height / 2;
      for (let i = 0; i < values.length / 2; i++) {
        const top = mid - Math.abs(values[i * 2 + 1]) * mid * .88;
        const bottom = mid + Math.abs(values[i * 2]) * mid * .88;
        ctx.fillRect(i * 2, top, 1, Math.max(1, bottom - top));
      }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url, visible]);
  return failed ? <span className="flex h-full items-center px-4 text-xs text-muted">Audio preview unavailable</span> : <div data-coach="waveforms" className="h-full w-full"><canvas ref={canvas} className="h-full w-full" aria-hidden /><span className="sr-only">Audio waveform preview for {title}</span></div>;
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
        <Select aria-label="Where to search" value={source} size="sm"
          onChange={value => { setSource(value as Source); setHits([]); setNote(""); }}
          options={SOURCES.map(s => ({ value: s.id, label: s.label }))} />
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
  if (!track) return <div className="mt-5 rounded-2xl border border-dashed border-border py-16 text-center text-muted">Select something in the Library to edit it.</div>;
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
  const [cueMenuFor, setCueMenuFor] = useState<string | null>(null);
  useEffect(() => {
    if (!cueMenuFor) return;
    const close = () => setCueMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [cueMenuFor]);
  const byId = useMemo(() => new Map((tracks as Track[]).map(t => [t.id, t])), [tracks]);
  const seq = sequences.find((s: Sequence) => s.id === sequenceId);
  const cueDrag = useDragList(reorder);
  // Rendered order is the drag preview while a drag is in flight, and the real order otherwise.
  const order: SequenceItem[] = !seq ? [] : cueDrag.drag ? moved(seq.items, cueDrag.drag.from, cueDrag.drag.to) : seq.items;
  const numbers = cueNumbers(order.map(item => {
    const track = byId.get(item.trackId);
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
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-muted">Pick a sequence in the rail above, or make one. Then add sounds and slides from the Library. Audio responds to ← →, visual media responds to A / D, and every cue can still be clicked.</div>
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
            <span className="ml-auto text-xs text-muted">{cueDrag.reorder ? "Drag any grip to move a cue. Scrolling is off while this is on." : cueIndex < 0 ? "Armed. Press → to fire cue 1" : "← → audio cues, A / D visual cues, W / S zoom"}</span>
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
              {seq.items.length === 0 ? <p className="rounded-2xl border border-dashed border-border py-10 text-center text-muted">Empty sequence. Add the selected item above.</p> : (
                <ol className="space-y-2" ref={cueDrag.list}>
                  <AnimatePresence>{order.map((item: SequenceItem, i: number) => {
                    const track = byId.get(item.trackId);
                    const kind: Kind = track ? kindOf(track) : "audio";
                    const Icon = kindIcon[kind];
                    const held = cueDrag.drag?.to === i;
                    return (
                    // Layout animation is off mid-drag: an animating row reports a moving rectangle,
                    // and the drop target is computed from those rectangles.
                    <motion.li key={item.id} layout={!cueDrag.dragging} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} onContextMenu={(event: ReactMouseEvent) => { event.preventDefault(); setCueMenuFor(item.id); }}>

                      <div className={`relative flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${cueMenuFor === item.id ? "z-30" : "z-0"} ${held ? "border-accent bg-accent/15 shadow-lg" : i === cueIndex ? "border-accent bg-accent/10" : "border-border bg-surface/50"}`}>
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
                          <Select aria-label="Transition" value={item.visual?.transition ?? "fade"} size="sm" className="order-last w-full shrink-0 sm:order-none sm:w-auto"
                            onChange={value => setItemTransition(item.id, value)}
                            options={["cut", "fade", "slide", "zoom"].map(t => ({ value: t, label: t }))} />
                        )}
                        <div className="flex shrink-0">
                          {/* Two clicks: chain this cue, then click the one it goes with. */}
                          {linking && linking !== item.id ? (
                            <Button size="sm" variant="flat" color="primary" onPress={() => { linkCues(linking, item.id); setLinking(""); }}>Link here</Button>
                          ) : (
                            <Tooltip content={item.link ? `Linked to cue ${numbers[order.findIndex((x: SequenceItem) => x.id === item.link)] ?? "?"}, click to unlink` : linking === item.id ? "Now click the cue this goes with" : "Fire this cue together with another"}>
                              <Button isIconOnly size="sm" variant={item.link || linking === item.id ? "solid" : "light"} color={item.link ? "secondary" : linking === item.id ? "primary" : "default"}
                                aria-label={item.link ? `Unlink ${item.label}` : linking === item.id ? `Cancel linking ${item.label}` : `Link ${item.label} to another cue`}
                                title={item.link ? "Unlink cue" : linking === item.id ? "Cancel linking" : "Link cue"}
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
                          <div className="relative">
                            <Button isIconOnly size="sm" variant="light" aria-label={`More actions for ${item.label}`} title="More actions" onPress={() => setCueMenuFor(cueMenuFor === item.id ? null : item.id)}><MoreHorizontal size={14} /></Button>
                            {cueMenuFor === item.id && <div className="absolute right-0 top-full z-40 mt-1 flex w-44 flex-col gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-glass">
                              <Button size="sm" variant="light" className="justify-start" onPress={() => { setCueMenuFor(null); moveItem(i, -1); }} isDisabled={i === 0}><ChevronUp size={14} />Move up</Button>
                              <Button size="sm" variant="light" className="justify-start" onPress={() => { setCueMenuFor(null); moveItem(i, 1); }} isDisabled={i === seq.items.length - 1}><ChevronDown size={14} />Move down</Button>
                              {kind !== "audio" && <Button size="sm" variant="light" className="justify-start" onPress={() => { const order = ["cut", "fade", "slide", "zoom"]; setItemTransition(item.id, order[(order.indexOf(item.visual?.transition ?? "fade") + 1) % order.length]); setCueMenuFor(null); }}><Repeat size={14} />Cycle transition</Button>}
                              <Button size="sm" variant="light" color="danger" className="justify-start" onPress={() => { setCueMenuFor(null); deleteItem(item.id); }}><Trash2 size={14} />Remove cue</Button>
                            </div>}
                          </div>
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
const ARMED_CONTROL_KEYS: (keyof Effects)[] = ["volume", "speed", "fadeIn", "fadeOut", "reverb"];

/**
 * The auto-advance countdown, isolated so its 10 Hz tick re-renders one `<span>` instead of the
 * whole Studio. `cueKey` restarts the clock when the cue changes; `onElapsed` goes through a ref so
 * a new closure from the parent does not restart it.
 */
function CueCountdown({ seconds, cueKey, onElapsed }: { seconds: number; cueKey: string; onElapsed: () => void }) {
  const [left, setLeft] = useState(seconds);
  const elapsed = useRef(onElapsed); elapsed.current = onElapsed;
  useEffect(() => {
    const started = Date.now();
    const tick = () => {
      const remaining = seconds - (Date.now() - started) / 1000;
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) { clearInterval(id); elapsed.current(); }
    };
    const id = window.setInterval(tick, 100);
    tick();
    return () => clearInterval(id);
  }, [seconds, cueKey]);
  if (left <= 0) return null;
  return <span className="shrink-0 rounded-xl border border-armed/40 bg-armed/10 px-2 py-1 font-mono text-xs text-armed">{formatTimer(left)}</span>;
}

/**
 * The transport for whatever cue is out.
 *
 * An armed deck unmounts the Player, so the only way to pause a cue was a keybind -- and the keybind
 * acted on the editor's element, not on the sound the audience could hear. Nothing on screen said
 * pausing was possible at all. Reads the element directly for the same reason the Player does:
 * `timeupdate` at four times a second must not re-render an armed Studio.
 */
function CueTransport({ element, label, onToggle, onStop, master, setMaster, commitMaster }: {
  element: HTMLAudioElement | null; label: string;
  onToggle: () => void; onStop: () => void;
  master: number; setMaster: (v: number) => void; commitMaster: () => void;
}) {
  const [now, setNow] = useState(0);
  const [span, setSpan] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!element) { setNow(0); setSpan(0); setRunning(false); return; }
    const read = () => {
      setNow(element.currentTime);
      setSpan(Number.isFinite(element.duration) ? element.duration : 0);
      setRunning(!element.paused);
    };
    read();
    const events = ["timeupdate", "durationchange", "loadedmetadata", "play", "pause", "ended", "seeked", "emptied"];
    for (const name of events) element.addEventListener(name, read);
    return () => { for (const name of events) element.removeEventListener(name, read); };
  }, [element]);

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
      <Button isIconOnly size="sm" variant="flat" isDisabled={!element}
        aria-label={running ? `Pause ${label}` : `Play ${label}`} title={running ? "Pause" : "Play"} onPress={onToggle}>
        {running ? <Pause size={15} fill="currentColor" aria-hidden /> : <Play size={15} fill="currentColor" aria-hidden />}
      </Button>
      <Button isIconOnly size="sm" variant="flat" color="danger" aria-label="Stop all sound" title="Stop all sound" onPress={onStop}>
        <Square size={14} fill="currentColor" aria-hidden />
      </Button>
      <span className="font-mono text-[11px] tabular-nums text-muted">{formatTimer(now)} / {span ? formatTimer(span) : "--:--"}</span>
      <div className="min-w-32 flex-1">
        <Slider aria-label={`Scrub ${label}`} minValue={0} maxValue={span || 1} step={0.05}
          value={Math.min(now, span || 1)} isDisabled={!element || !span}
          onChange={next => { if (element) element.currentTime = next; }} />
      </div>
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
        <Volume2 size={13} aria-hidden />
        <span className="w-24">
          <Slider aria-label="Master output level" minValue={0} maxValue={1} step={0.01} value={master}
            onChange={setMaster} onChangeEnd={commitMaster} />
        </span>
        <span className="w-8 text-right font-mono tabular-nums">{Math.round(master * 100)}</span>
      </span>
    </div>
  );
}

function ArmedEffectControls({ effects, update, commit }: { effects: Effects; update: (fx: Effects) => void; commit: () => void }) {
  return (
    <div data-armed-effects className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/70 bg-surface/35 p-3 sm:grid-cols-3 lg:grid-cols-5">
      {ARMED_CONTROL_KEYS.map(key => {
        const control = controls.find(candidate => candidate.key === key)!;
        return <Slider key={control.key} aria-label={`Armed ${control.label}`} size="sm" color="primary" label={control.label}
          minValue={control.min} maxValue={control.max} step={control.step} value={Number(effects[control.key])}
          onChange={value => update({ ...effects, [control.key]: Array.isArray(value) ? value[0] : value })}
          onChangeEnd={commit}
          getValue={value => `${Number(value).toFixed(control.step < .1 ? 2 : 1)}${control.unit ?? ""}`} />;
      })}
    </div>
  );
}

/**
 * The transport, and the only thing that needs to know where the playhead is. It reads the media
 * element directly rather than being handed `time` as a prop: `timeupdate` fires roughly four times
 * a second, and holding that in Studio's state re-rendered the entire page at the same rate.
 */
function Player({ track, unsaved, playing, toggle, audio, seek, jump, loop, setLoop, effects, update }: any) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(() => (audio as HTMLAudioElement | null)?.currentTime ?? 0);
  const [duration, setDuration] = useState(() => {
    const d = (audio as HTMLAudioElement | null)?.duration;
    return Number.isFinite(d) ? (d as number) : 0;
  });
  useEffect(() => {
    const a = audio as HTMLAudioElement | null;
    if (!a) return;
    const tick = () => setTime(a.currentTime);
    const meta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    tick(); meta();
    a.addEventListener("timeupdate", tick); a.addEventListener("seeked", tick);
    a.addEventListener("loadedmetadata", meta); a.addEventListener("durationchange", meta); a.addEventListener("emptied", meta);
    return () => {
      a.removeEventListener("timeupdate", tick); a.removeEventListener("seeked", tick);
      a.removeEventListener("loadedmetadata", meta); a.removeEventListener("durationchange", meta); a.removeEventListener("emptied", meta);
    };
  }, [audio]);
  const speed = Number(effects.speed) || 1;
  return (
    // Docked flush to the bottom edge on a phone -- a floating card wastes the one strip of screen a
    // thumb reaches without moving the hand. It floats again once there is room.
    <motion.section initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="glass mobile-player fixed inset-x-3 bottom-[calc(var(--nav-h)+var(--safe-b)+.75rem)] z-30 mx-auto max-w-[1080px] rounded-2xl p-3 shadow-glass sm:inset-x-4 sm:bottom-4 sm:rounded-lg sm:p-4">
      {/* Phones get the title above the transport; there is no room for both on one line. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p aria-live="polite" data-player-track-id={track.id} className="flex items-center gap-2 truncate text-sm font-bold capitalize">
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
      <Slider aria-label="Progress" size="sm" color="primary" className="mt-2" minValue={0} maxValue={duration || 0.0001} step={0.1} value={Math.min(time, duration || 0)} onChange={v => { const next = Array.isArray(v) ? v[0] : v; setTime(next); seek(next); }} />
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

