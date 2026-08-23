import type { DeckSlide } from "../types";

const view = (buffer: ArrayBuffer) => new DataView(buffer);
const sig = (data: DataView, at: number) => data.getUint32(at, true);

/** PPTX is a ZIP package. Reading its central directory is enough to discover slide order. */
export async function slidesFromPptx(file: File): Promise<DeckSlide[]> {
  const data = view(await file.arrayBuffer());
  const start = Math.max(0, data.byteLength - 65557);
  let eocd = -1;
  for (let at = data.byteLength - 22; at >= start; at--) {
    if (sig(data, at) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) return [];
  const count = data.getUint16(eocd + 10, true);
  const offset = data.getUint32(eocd + 16, true);
  const found: number[] = [];
  let at = offset;
  for (let n = 0; n < count && at + 46 <= data.byteLength; n++) {
    if (sig(data, at) !== 0x02014b50) break;
    const nameLength = data.getUint16(at + 28, true);
    const extraLength = data.getUint16(at + 30, true);
    const commentLength = data.getUint16(at + 32, true);
    const name = new TextDecoder().decode(new Uint8Array(data.buffer, at + 46, nameLength));
    const match = name.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
    if (match) found.push(Number(match[1]));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return found.sort((a, b) => a - b).map((_, index) => ({ index, label: `Slide ${index + 1}` }));
}

export const slideLabels = (count: number): DeckSlide[] => Array.from({ length: Math.max(0, count) }, (_, index) => ({ index, label: `Slide ${index + 1}` }));
