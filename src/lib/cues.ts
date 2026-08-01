import type { Sequence, Track } from "../types";

const cues = [
  ["Thunder and Rain", "thunder-and-rain.mp3"], ["Doorbell - Colonel Mustard", "quick-doorbell.mp3"], ["Doorbell - Miss Scarlet", "quick-doorbell.mp3"], ["Doorbell - Mrs White", "quick-doorbell.mp3"], ["Doorbell - Mrs Peacock", "quick-doorbell.mp3"], ["Doorbell - Mr Green", "quick-doorbell.mp3"], ["Doorbell - Mr Boddy", "quick-doorbell.mp3"], ["Door locked", "quick-doorbell.mp3"], ["Loud thunder", "thunder-sound-effect (1).mp3"], ["Ominous music", "heroic music 1.mp3"], ["Gunshot", "gunshotjbudden.mp3"], ["Slap", "slap.mp3"], ["Panic thunder", "thunder-sound-effect (2).mp3"], ["Gunshot - Rosie", "gunshotjbudden.mp3"], ["Slap - recap", "slap.mp3"], ["Toilet flushing", "flushing-the-toilet.mp3"], ["Gunshot - finale", "gunshotjbudden.mp3"], ["Heroic police music", "heroic music 1.mp3"]
] as const;

const effects = { speed: 1, volume: .9, gain: 1, reverb: 0, fadeIn: 0, fadeOut: 0, distortion: 0, reverse: false };
export const initialTracks = (): Track[] => [...new Map(cues.map(([, file]) => [file, { id: file, title: file.replace(/\.mp3$/, "").replace(/[-_]/g, " "), url: `/audio/${encodeURIComponent(file)}`, effects: { ...effects }, createdAt: new Date().toISOString() }])).values()];
export const clueLessSequence = (tracks: Track[]): Sequence => ({ id: "clue-less-show", name: "Clue-less: full script cues", createdAt: new Date().toISOString(), items: cues.map(([label, file], index) => ({ id: `cue-${index + 1}`, label: `AUDIO ${index + 1}: ${label}`, trackId: tracks.find(track => track.id === file)?.id ?? "", effects: { ...effects } })) });
