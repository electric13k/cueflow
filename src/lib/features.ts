import type { Sequence, Track } from "../types";
import { local } from "./store";

export type Template = { id: string; name: string; sequence: Sequence; createdAt: string };
export type RunEvent = {
  id: string;
  at: string;
  type: "cue" | "start" | "end" | "rehearsed" | "note";
  sequenceId?: string;
  sequenceName?: string;
  cueIndex?: number;
  label?: string;
  note?: string;
};
export type RehearsalState = {
  active: boolean;
  sequenceId: string;
  completed: string[];
  notes: Record<string, string>;
};
export type SequenceHistory = {
  id: string;
  at: string;
  label: string;
  sequences: Sequence[];
};
export type FeatureState = {
  version: 1;
  favorites: string[];
  collections: Record<string, string[]>;
  templates: Template[];
  cueTimers: Record<string, number>;
  rehearsal: RehearsalState;
  runHistory: RunEvent[];
  undo: SequenceHistory[];
  redo: SequenceHistory[];
};

export type ProjectExport = {
  format: "cueflow-project";
  version: 1;
  exportedAt: string;
  projectId: string | null;
  tracks: Track[];
  sequences: Sequence[];
  features: FeatureState;
};

const blank = (): FeatureState => ({
  version: 1,
  favorites: [],
  collections: {},
  templates: [],
  cueTimers: {},
  rehearsal: { active: false, sequenceId: "", completed: [], notes: {} },
  runHistory: [],
  undo: [],
  redo: [],
});

const key = (projectId: string | null) => projectId ? `features:${projectId}` : "features";
const copy = <T,>(value: T): T => {
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)) as T; }
};

export function loadFeatures(projectId: string | null): FeatureState {
  const stored = local.get<Partial<FeatureState>>(key(projectId), {});
  const base = blank();
  return {
    ...base,
    ...stored,
    favorites: Array.isArray(stored.favorites) ? stored.favorites : [],
    collections: stored.collections && typeof stored.collections === "object" ? stored.collections : {},
    templates: Array.isArray(stored.templates) ? stored.templates : [],
    cueTimers: stored.cueTimers && typeof stored.cueTimers === "object" ? stored.cueTimers : {},
    rehearsal: { ...base.rehearsal, ...(stored.rehearsal ?? {}) },
    runHistory: Array.isArray(stored.runHistory) ? stored.runHistory.slice(-500) : [],
    undo: Array.isArray(stored.undo) ? stored.undo.slice(-40) : [],
    redo: Array.isArray(stored.redo) ? stored.redo.slice(-40) : [],
  };
}

export function saveFeatures(projectId: string | null, state: FeatureState) {
  local.set(key(projectId), { ...state, version: 1, runHistory: state.runHistory.slice(-500), undo: state.undo.slice(-40), redo: state.redo.slice(-40) });
}

export function toggleFavorite(state: FeatureState, trackId: string): FeatureState {
  const favorites = state.favorites.includes(trackId) ? state.favorites.filter(id => id !== trackId) : [...state.favorites, trackId];
  return { ...state, favorites };
}

export function setCollection(state: FeatureState, name: string, trackIds: string[]): FeatureState {
  const clean = name.trim();
  if (!clean) return state;
  return { ...state, collections: { ...state.collections, [clean]: [...new Set(trackIds)] } };
}

export function addToCollection(state: FeatureState, name: string, trackId: string): FeatureState {
  const ids = state.collections[name] ?? [];
  return setCollection(state, name, [...ids, trackId]);
}

export function removeFromCollections(state: FeatureState, trackId: string): FeatureState {
  return { ...state, favorites: state.favorites.filter(id => id !== trackId), collections: Object.fromEntries(Object.entries(state.collections).map(([name, ids]) => [name, ids.filter(id => id !== trackId)])) };
}

export function recordHistory(state: FeatureState, before: Sequence[], after: Sequence[], label: string): FeatureState {
  if (JSON.stringify(before) === JSON.stringify(after)) return state;
  return {
    ...state,
    undo: [...state.undo, { id: crypto.randomUUID(), at: new Date().toISOString(), label, sequences: copy(before) }].slice(-40),
    redo: [],
  };
}

export function undoSequences(state: FeatureState, current: Sequence[]): { state: FeatureState; sequences: Sequence[] } | null {
  const entry = state.undo[state.undo.length - 1];
  if (!entry) return null;
  return {
    sequences: copy(entry.sequences),
    state: { ...state, undo: state.undo.slice(0, -1), redo: [...state.redo, { id: crypto.randomUUID(), at: new Date().toISOString(), label: entry.label, sequences: copy(current) }].slice(-40) },
  };
}

export function redoSequences(state: FeatureState, current: Sequence[]): { state: FeatureState; sequences: Sequence[] } | null {
  const entry = state.redo[state.redo.length - 1];
  if (!entry) return null;
  return {
    sequences: copy(entry.sequences),
    state: { ...state, redo: state.redo.slice(0, -1), undo: [...state.undo, { id: crypto.randomUUID(), at: new Date().toISOString(), label: entry.label, sequences: copy(current) }].slice(-40) },
  };
}

export function makeTemplate(name: string, sequence: Sequence): Template {
  return { id: crypto.randomUUID(), name: name.trim() || sequence.name, sequence: copy({ ...sequence, id: crypto.randomUUID(), name: name.trim() || `${sequence.name} template` }), createdAt: new Date().toISOString() };
}

export function buildProjectExport(projectId: string | null, tracks: Track[], sequences: Sequence[], features: FeatureState): Blob {
  const payload: ProjectExport = { format: "cueflow-project", version: 1, exportedAt: new Date().toISOString(), projectId, tracks: copy(tracks), sequences: copy(sequences), features: copy(features) };
  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

export async function readProjectExport(file: File): Promise<ProjectExport> {
  const raw: unknown = JSON.parse(await file.text());
  if (!raw || typeof raw !== "object") throw new Error("That file is not a Cueflow project export.");
  const data = raw as Partial<ProjectExport>;
  if (data.format !== "cueflow-project" || data.version !== 1 || !Array.isArray(data.tracks) || !Array.isArray(data.sequences)) throw new Error("That Cueflow export is unsupported or incomplete.");
  return { format: "cueflow-project", version: 1, exportedAt: data.exportedAt ?? new Date().toISOString(), projectId: data.projectId ?? null, tracks: data.tracks as Track[], sequences: data.sequences as Sequence[], features: { ...blank(), ...(data.features ?? {}) } };
}

export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const formatTimer = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.max(0, Math.ceil(seconds % 60))).padStart(2, "0")}`;
