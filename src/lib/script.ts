/**
 * Turns a Word or PDF script into HTML the reader can show. The point is that the page keeps the
 * shape the writer gave it -- headings, stage directions in italics, character names in bold -- and
 * loses only the paper: no white page, no margins, no drop shadow. It should read as if the script
 * were typed into CueFlow.
 *
 * Both parsers are loaded on demand. They are large, and most sessions never open a script.
 */

/** mammoth emits a small, predictable tag set. Anything outside it is dropped, attributes and all. */
const TAGS = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "SPAN", "DIV"]);

/**
 * A script reads as a script because of its shape: character names centred, dialogue indented,
 * stage directions inset. That shape lives in `style` and `align`, so stripping every attribute
 * throws the script away along with the paper. These six properties are the shape, and nothing
 * else is kept.
 */
const STYLE_PROPS = new Set(["text-align", "margin-left", "padding-left", "text-indent", "font-style", "font-weight"]);
/** No fetch, no code, no escape trickery inside a value that is otherwise allowed. */
const UNSAFE_VALUE = /url\(|expression|javascript:|\\/i;
const ALIGN_VALUES = new Set(["left", "right", "center", "justify"]);
/** Exactly the classes the mammoth style map below emits. A class from anywhere else is dropped. */
const CLASSES = new Set([
  "script-character", "script-dialogue", "script-parenthetical", "script-transition", "script-scene",
  "script-center", "script-right", "script-indent-1", "script-indent-2", "script-indent-3",
]);

/** Keeps the allowlisted declarations of a `style` attribute and drops the rest. */
function safeStyle(style: string) {
  return style.split(";")
    .map(rule => {
      const at = rule.indexOf(":");
      return at < 0 ? ["", ""] as const : [rule.slice(0, at).trim().toLowerCase(), rule.slice(at + 1).trim()] as const;
    })
    .filter(([prop, value]) => STYLE_PROPS.has(prop) && !!value && !UNSAFE_VALUE.test(value))
    .map(([prop, value]) => `${prop}: ${value}`)
    .join("; ");
}

/** The kept form of one attribute, or "" for drop it. */
function allowed(name: string, value: string) {
  if (name === "style") return safeStyle(value);
  if (name === "align") return ALIGN_VALUES.has(value.trim().toLowerCase()) ? value.trim().toLowerCase() : "";
  if (name === "class") return value.split(/\s+/).filter(c => CLASSES.has(c)).join(" ");
  return "";
}

/**
 * The file comes off the user's own disk, but a .docx is a zip of XML written by whoever sent it,
 * and this HTML is injected into the page. Allowlist the tags, then allowlist attributes by name:
 * `style` down to six layout properties, `align` down to four values, `class` down to the classes
 * this file itself emits. Nothing on those lists can run anything, so the guarantee is unchanged
 * and the shape of the script survives.
 */
export function clean(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      walk(child);
      if (!TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const keep = allowed(name, attr.value);
        child.removeAttribute(attr.name);
        if (keep) child.setAttribute(name, keep);
      }
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

/**
 * Word's own paragraph styles, and the synthetic ones `shapeParagraph` invents, mapped to the
 * classes `.script-prose` styles. mammoth matches these before its default map.
 */
const STYLE_MAP = [
  "p[style-name='Character'] => p.script-character:fresh",
  "p[style-name='Dialogue'] => p.script-dialogue:fresh",
  "p[style-name='Parenthetical'] => p.script-parenthetical:fresh",
  "p[style-name='Transition'] => p.script-transition:fresh",
  "p[style-name='Scene Heading'] => p.script-scene:fresh",
  "p[style-name='cue-center'] => p.script-center:fresh",
  "p[style-name='cue-right'] => p.script-right:fresh",
  "p[style-name='cue-indent-1'] => p.script-indent-1:fresh",
  "p[style-name='cue-indent-2'] => p.script-indent-2:fresh",
  "p[style-name='cue-indent-3'] => p.script-indent-3:fresh",
];

type Para = { type?: string; children?: Para[]; styleName?: string | null; alignment?: string | null; indent?: { start?: string | null } | null };
/** Styles that already mean something, either to us or to mammoth's default map. Never overwritten. */
const NAMED = /^(Character|Dialogue|Parenthetical|Transition|Scene Heading|Heading|Title|Subtitle|Quote)/i;

/**
 * mammoth reads a paragraph's alignment and indent into its document model and then never writes
 * them out: its HTML is semantic, and direct formatting is not semantic. A script typed in plain
 * Word carries its whole shape in exactly that direct formatting, so give such a paragraph a style
 * name the map above knows, and the shape comes through as a class.
 */
export function shapeParagraph(p: Para) {
  if (p.styleName && NAMED.test(p.styleName)) return p;
  if (p.alignment === "center") p.styleName = "cue-center";
  else if (p.alignment === "right" || p.alignment === "end") p.styleName = "cue-right";
  else {
    // Indents are twips. 720 of them is half an inch, which is Word's default tab.
    const level = Math.min(3, Math.floor(Number(p.indent?.start ?? 0) / 720));
    if (level >= 1) p.styleName = `cue-indent-${level}`;
  }
  return p;
}

const transformDocument = (el: Para): Para => {
  el.children?.forEach(transformDocument);
  return el.type === "paragraph" ? shapeParagraph(el) : el;
};

export async function parseScript(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { styleMap: STYLE_MAP, transformDocument });
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

/** Which cues have already flashed, by marker id. One set per level: a warn does not imply a hit. */
export type Armed = { warn: Set<string>; hit: Set<string> };

/**
 * Hysteresis, in pixels. A cue re-arms only once it is this much further ahead than the warning
 * distance, so a hand jiggling the wheel on the boundary cannot flash the same cue twice.
 */
export const REARM_SLACK = 24;

/**
 * What one marker is owed, given how far ahead of the reading line it now sits. `fired` is the
 * running record and is updated in place.
 *
 * The re-arming is the point. Scrolling back up puts a cue in front of the reading line again, and
 * a cue in front of the reading line has not happened yet, whether it got back there by the rewind
 * button or by a hand on the scrollbar. Only forgetting on rewind is what left manual scrolling
 * silent for the rest of the run.
 */
export function cueAlert(ahead: number, lookahead: number, id: string, fired: Armed): "warn" | "hit" | null {
  if (ahead > lookahead + REARM_SLACK) { fired.warn.delete(id); fired.hit.delete(id); return null; }
  if (ahead <= 0) {
    if (fired.hit.has(id)) return null;
    fired.hit.add(id); fired.warn.add(id);
    return "hit";
  }
  if (ahead <= lookahead && !fired.warn.has(id)) { fired.warn.add(id); return "warn"; }
  return null;
}

/**
 * Find in script. Same text-node walk as `markKeywords` and for the same reason: a search for "p"
 * must not touch the markup. Each hit is numbered so the reader can step to one by index.
 *
 * Unlike a cue word this is a plain substring, not a whole word: someone hunting a half-remembered
 * line types the middle of it.
 */
export function findInScript(html: string, query: string) {
  const needle = query.trim();
  if (!needle) return { html, hits: 0 };
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const queue: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) queue.push(n as Text);

  let hits = 0;
  while (queue.length) {
    const node = queue.shift()!;
    const at = node.data.search(re);
    if (at < 0) continue;
    const hit = node.splitText(at);
    const rest = hit.splitText(needle.length);
    const span = doc.createElement("span");
    span.setAttribute("class", "find-hit");
    span.setAttribute("data-find", String(hits++));
    span.textContent = hit.data;
    hit.replaceWith(span);
    // The remainder has not been searched yet, and one line can hold the phrase twice.
    queue.unshift(rest);
  }
  return { html: doc.body.innerHTML, hits };
}
