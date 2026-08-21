import type { Deck, Master, Slide } from "./deck";
import { zip, type Bytes, type ZipEntry } from "./zip";

const enc = new TextEncoder();
const text = (value: string) => enc.encode(value) as Bytes;
const esc = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");
const hex = (value: string) => value.replace(/^#/, "").toUpperCase().padEnd(6, "0").slice(0, 6);
const EMU = 914400;
const SLIDE_W = 13.333 * EMU;
const SLIDE_H = 7.5 * EMU;

type SlideImage = { source: string; path: string; ext: "png" | "jpg"; bytes: Bytes };
type ImageMap = Map<string, SlideImage>;

const rels = (target: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${target}</Relationships>`;

function run(value: string, size: number, color: string, bold = false) {
  return `<a:r><a:rPr lang="en-US" sz="${size}"${bold ? " b=\"1\"" : ""}><a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill></a:rPr><a:t>${esc(value)}</a:t></a:r>`;
}

function paragraph(value: string, size: number, color: string, bold = false, bullet = false) {
  return `<a:p>${bullet ? "<a:pPr marL=\"420000\" indent=\"-210000\"><a:buChar char=\"•\"/></a:pPr>" : ""}${run(value, size, color, bold)}<a:endParaRPr lang="en-US"/></a:p>`;
}

function shape(id: number, name: string, x: number, y: number, cx: number, cy: number, body: string, fill?: string) {
  const fillXml = fill ? `<a:solidFill><a:srgbClr val="${hex(fill)}"/></a:solidFill>` : "<a:noFill/>";
  const textBody = body || "<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>${fillXml}<a:ln><a:noFill/></a:ln></p:spPr>${textBody}</p:sp>`;
}

function textShape(id: number, name: string, value: string, x: number, y: number, cx: number, cy: number, size: number, color: string, bold = false, bullet = false) {
  const body = `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${value.split("\n").map(line => paragraph(line, size, color, bold, bullet)).join("")}</p:txBody>`;
  return shape(id, name, x, y, cx, cy, body);
}

function imageShape(id: number, image: SlideImage, x: number, y: number, cx: number, cy: number) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(image.path)}"/><p:cNvPicPr preferRelativeResize="0"/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function slideXml(master: Master, slide: Slide, image?: SlideImage) {
  const half = slide.layout === "imageLeft" || slide.layout === "imageRight";
  const imageLeft = slide.layout === "imageLeft";
  const textX = half && imageLeft ? SLIDE_W / 2 : 0;
  const textW = half ? SLIDE_W / 2 : SLIDE_W;
  const pad = half ? 0.55 * EMU : 0.85 * EMU;
  const x = textX + pad;
  const w = textW - pad * 2;
  const titleY = slide.layout === "title" ? 2.0 * EMU : slide.layout === "image" ? 5.5 * EMU : 0.9 * EMU;
  const bodyY = titleY + (slide.layout === "title" ? 1.55 * EMU : 1.4 * EMU);
  const imageXml = image && slide.layout !== "title" && slide.layout !== "text"
    ? imageShape(2, image, imageLeft ? 0 : SLIDE_W / 2, 0, SLIDE_W / 2, SLIDE_H)
    : "";
  const title = slide.title ? textShape(3, "Title", slide.title, x, titleY, w, 1.2 * EMU, slide.layout === "title" ? 34 * 12700 : 26 * 12700, master.fg, true) : "";
  const accent = shape(4, "CueFlow accent", master.align === "center" || slide.layout === "title" ? SLIDE_W / 2 - 0.42 * EMU : x, titleY + 1.15 * EMU, 0.84 * EMU, 0.07 * EMU, "", master.accent);
  const body = slide.body && slide.layout !== "image" ? textShape(5, "Body", slide.body, x, bodyY, w, 3.8 * EMU, half ? 19 * 12700 : 22 * 12700, master.fg, false, master.bullets && master.align === "left") : "";
  const bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(master.bg)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
  const tree = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${imageXml}${title}${accent}${body}</p:spTree>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${bg}<p:cSld name="${esc(slide.title || "CueFlow slide")}">${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const CONTENT_TYPES = (count: number, exts: Set<string>) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.has("png") ? '<Default Extension="png" ContentType="image/png"/>' : ""}${exts.has("jpg") ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : ""}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${Array.from({ length: count }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`;

const presentation = (count: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${Math.round(SLIDE_W)}" cy="${Math.round(SLIDE_H)}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

const presentationRels = (count: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`;

const masterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
const layoutXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="CueFlow"><a:themeElements><a:clrScheme name="CueFlow"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="241F1C"/></a:dk2><a:lt2><a:srgbClr val="EFE7D8"/></a:lt2><a:accent1><a:srgbClr val="C9737C"/></a:accent1><a:accent2><a:srgbClr val="D4A957"/></a:accent2><a:accent3><a:srgbClr val="A3B37A"/></a:accent3><a:accent4><a:srgbClr val="D98A5A"/></a:accent4><a:accent5><a:srgbClr val="E05566"/></a:accent5><a:accent6><a:srgbClr val="8A2B35"/></a:accent6><a:hlink><a:srgbClr val="6E2029"/></a:hlink><a:folHlink><a:srgbClr val="6E2029"/></a:folHlink></a:clrScheme><a:fontScheme name="CueFlow"><a:majorFont><a:latin typeface="Bodoni Moda"/></a:majorFont><a:minorFont><a:latin typeface="Source Serif 4"/></a:minorFont></a:fontScheme><a:fmtScheme name="CueFlow"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`;

export async function deckToPptx(deck: Deck, images: Record<string, HTMLImageElement | null | undefined>, title = "CueFlow deck") {
  const imageMap: ImageMap = new Map();
  let imageNo = 0;
  for (const slide of deck.slides) {
    if (!slide.image || imageMap.has(slide.image) || !images[slide.image]) continue;
    const response = await fetch(slide.image);
    if (!response.ok) throw new Error("The selected slide image could not be read.");
    const type = response.headers.get("content-type") || "image/png";
    const ext = type.includes("jpeg") || type.includes("jpg") ? "jpg" : "png";
    imageNo += 1;
    imageMap.set(slide.image, { source: slide.image, path: `ppt/media/image${imageNo}.${ext}`, ext, bytes: new Uint8Array(await response.arrayBuffer()) as Bytes });
  }

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", body: text(CONTENT_TYPES(deck.slides.length, new Set([...imageMap.values()].map(x => x.ext)))) },
    { name: "_rels/.rels", body: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`) },
    { name: "ppt/presentation.xml", body: text(presentation(deck.slides.length)) },
    { name: "ppt/_rels/presentation.xml.rels", body: text(presentationRels(deck.slides.length)) },
    { name: "ppt/slideMasters/slideMaster1.xml", body: text(masterXml) },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", body: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`) },
    { name: "ppt/slideLayouts/slideLayout1.xml", body: text(layoutXml) },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", body: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`) },
    { name: "ppt/theme/theme1.xml", body: text(themeXml) },
  ];

  deck.slides.forEach((slide, index) => {
    const image = slide.image ? imageMap.get(slide.image) : undefined;
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, body: text(slideXml(deck.master, slide, image)) });
    const target = image ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${image.path.split("/").pop()}"/>` : "";
    entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, body: text(rels(target)) });
  });
  for (const image of imageMap.values()) entries.push({ name: image.path, body: image.bytes });

  return new File([zip(entries)], `${title.replace(/[^a-z0-9 _.-]/gi, "").trim() || "CueFlow deck"}.pptx`, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
