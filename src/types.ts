export type Effects = { speed: number; volume: number; gain: number; reverb: number; fadeIn: number; fadeOut: number; distortion: number; reverse: boolean };
export type Track = { id: string; title: string; url: string; storagePath?: string; duration?: number; effects: Effects; createdAt: string };
export type SequenceItem = { id: string; trackId: string; label: string; effects: Effects };
export type Sequence = { id: string; name: string; items: SequenceItem[]; createdAt: string };
export const defaultEffects = (): Effects => ({ speed: 1, volume: 0.9, gain: 1, reverb: 0, fadeIn: 0, fadeOut: 0, distortion: 0, reverse: false });
export const cloneEffects = (effects: Effects): Effects => ({ ...effects });
