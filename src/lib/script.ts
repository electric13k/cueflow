/**
 * Turns a Word or PDF script into HTML the reader can show. The point is that the page keeps the
 * shape the writer gave it -- headings, stage directions in italics, character names in bold -- and
 * loses only the paper: no white page, no margins, no drop shadow. It should read as if the script
 * were typed into CueFloww.
 *
 * Both parsers are loaded on demand. They are large, and most sessions never open a script.
 */

/** mammoth emits a small, predictable tag set. Anything outside it is dropped, attributes and all. */
const TAGS = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "SPAN", "DIV"]);

/**
 * The file comes off the user's own disk, but a .docx is a zip of XML written by whoever sent it,
 * and this HTML is injected into the page. Allowlist the tags, drop every attribute: formatting
 * survives, anything executable does not.
 */
export function clean(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      walk(child);
      if (!TAGS.has(child.tagName)) child.replaceWith(...child.childNodes);
      else for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

const escape = (s: string) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

/** Plain text: blank lines separate paragraphs, everything else keeps its line break. */
const fromText = (text: string) => text
  .split(/\n{2,}/)
  .map(block => `<p>${escape(block.trim()).replace(/\n/g, "<br>")}</p>`)
  .join("");

/**
 * A PDF stores glyphs at coordinates, not paragraphs, so structure has to be inferred: items on the
 * same baseline are one line, a line noticeably bigger than the body is a heading, and a wide
 * vertical gap starts a new block. Rough, but it keeps a script looking like a script.
 */
async function fromPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    type Line = { y: number; size: number; text: string };
    const lines: Line[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const size = Math.abs(item.transform[0]) || 12;
      const last = lines[lines.length - 1];
      // Same baseline within a couple of points is the same line, whatever order it arrived in.
      if (last && Math.abs(last.y - y) <= 2) { last.text += (item.hasEOL ? " " : "") + item.str; last.size = Math.max(last.size, size); }
      else lines.push({ y, size, text: item.str });
    }
    if (!lines.length) continue;
    const body = [...lines].map(l => l.size).sort((a, b) => a - b)[Math.floor(lines.length / 2)];
    lines.forEach((line, i) => {
      const gap = i > 0 ? Math.abs(lines[i - 1].y - line.y) : 0;
      const text = escape(line.text.trim());
      if (!text) return;
      if (line.size > body * 1.25) out.push(`<h3>${text}</h3>`);
      else if (gap > body * 1.8) out.push(`<p>${text}</p>`);
      else if (out.length && out[out.length - 1].startsWith("<p>")) out[out.length - 1] = out[out.length - 1].replace(/<\/p>$/, `<br>${text}</p>`);
      else out.push(`<p>${text}</p>`);
    });
  }
  return out.join("");
}

export async function parseScript(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return clean(value);
  }
  if (name.endsWith(".pdf")) return clean(await fromPdf(file));
  if (name.endsWith(".doc")) throw new Error("The old .doc format cannot be read in a browser. Save it as .docx or PDF first.");
  return fromText(await file.text());
}

// --- Keyword alerts ---------------------------------------------------------------------------
export type Cue = { id: string; words: string; message: string };

/**
 * The script lives in localStorage rather than in React state, because the reader can be a popup or
 * a separate tab: they are different documents and share nothing else. Whoever writes it broadcasts
 * `{type:"script"}` and every open reader picks the new one up.
 */
export type ScriptDoc = { name: string; html: string; cues: Cue[]; lookahead: number };
const KEY = "cueflow:script";
export const emptyDoc = (): ScriptDoc => ({ name: "", html: "", cues: [], lookahead: 260 });

export function loadScript(): ScriptDoc {
  try {
    const doc = { ...emptyDoc(), ...JSON.parse(localStorage.getItem(KEY) || "{}") } as ScriptDoc;
    // Sanitised again on the way out, not only on the way in: this HTML ends up in innerHTML, and
    // one allowlist pass immediately before rendering is what actually guarantees it is safe.
    return { ...doc, html: clean(doc.html || "") };
  } catch { return emptyDoc(); }
}
export function saveScript(doc: ScriptDoc) {
  // A long script can exceed the quota. Losing the alert setup silently would be worse than saying so.
  try { localStorage.setItem(KEY, JSON.stringify(doc)); }
  catch { throw new Error("That script is too large to keep in this browser. Try a shorter file."); }
}

/** Splits "lights, LX 4" into the words that each count as a hit on their own. */
export const keywordsOf = (cue: Cue) => cue.words.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);

/**
 * Wraps every keyword occurrence in a marker the reader can find and scroll to. Done on the HTML
 * string with a text-node walk rather than a regex over the markup, so a keyword that happens to
 * match a tag name cannot corrupt the document.
 */
export function markKeywords(html: string, cues: Cue[]) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  // Whole words only. An operator who lists "LX" wants the cue, not every "flexible" in the script.
  const pairs = cues.flatMap(cue => keywordsOf(cue).map(word => ({
    cue, word, re: new RegExp(`(?<![\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i"),
  })));
  if (!pairs.length) return { html, hits: 0 };
  let hits = 0;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const queue: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) queue.push(n as Text);

  // A queue rather than a plain loop: splitting a node leaves a remainder that has not been
  // searched yet, and a line naming the same cue twice has to light up twice.
  while (queue.length) {
    const node = queue.shift()!;
    // Earliest match wins; on a tie the longer word does, so "LX 4" beats "LX" when both are listed.
    const found = pairs
      .map(p => ({ ...p, at: node.data.search(p.re) }))
      .filter(p => p.at >= 0)
      .sort((a, b) => a.at - b.at || b.word.length - a.word.length)[0];
    if (!found) continue;
    const hit = node.splitText(found.at);
    const rest = hit.splitText(found.word.length);
    const mark = doc.createElement("mark");
    mark.setAttribute("data-cue", found.cue.id);
    mark.setAttribute("data-hit", String(hits++));
    mark.textContent = hit.data;
    hit.replaceWith(mark);
    queue.unshift(rest);
  }
  return { html: doc.body.innerHTML, hits };
}
