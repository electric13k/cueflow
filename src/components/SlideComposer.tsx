import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch } from "../ui";
import { AlignCenter, AlignLeft, GripVertical, ImagePlus, Plus, Trash2, X } from "lucide-react";
import {
  addSlide, deckFiles, drawSlide, indexOf, LAYOUTS, moveSlide, newDeck, patchSlide, removeSlide,
  setMaster, slideName, THEMES, wantsImage, type Deck, type Layout, type Master, type Slide,
} from "../lib/deck";
import { moved, useDragList } from "../lib/dragList";

/** Images live outside the deck: the document stays plain data, the decoded bitmaps stay here. */
type Img = HTMLImageElement | null | undefined;

/**
 * A deck editor, not a slide typer. Following the pptWeb editor
 * (github.com/theBigGavin/pptWeb): the deck is the document, the theme is a master shared by every
 * slide, and each slide picks a layout rather than a free canvas — a slide read from the back of a
 * room needs to line up with the one before it, and dragging text anywhere guarantees it will not.
 * No pptWeb code is used here.
 *
 * Output is unchanged: every slide leaves as its own PNG in the library, so a one-slide deck is the
 * single cue this used to make.
 */
export default function SlideComposer({ open, onClose, onCreate }: {
  open: boolean; onClose: () => void; onCreate: (file: File, title: string) => Promise<void>;
}) {
  const [deck, setDeck] = useState<Deck>(newDeck);
  const [currentId, setCurrentId] = useState(() => deck.slides[0].id);
  const [images, setImages] = useState<Record<string, Img>>({});
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  const at = Math.max(0, indexOf(deck, currentId));
  const current = deck.slides[at] ?? deck.slides[0];
  const strip = useDragList((from, to) => setDeck(d => moveSlide(d, from, to)));
  const order = strip.drag ? moved(deck.slides, strip.drag.from, strip.drag.to) : deck.slides;

  const patch = (p: Partial<Omit<Slide, "id">>) => setDeck(d => patchSlide(d, current.id, p));
  const master = (p: Partial<Master>) => setDeck(d => setMaster(d, p));

  useEffect(() => {
    if (open && canvas.current) drawSlide(canvas.current, deck.master, current, current.image ? images[current.image] : null);
  }, [open, deck, current, images]);

  /** An object URL holds the whole bitmap until it is revoked, and a rehearsal makes a lot of them. */
  const drop = (url?: string) => { if (url) { URL.revokeObjectURL(url); setImages(m => { const n = { ...m }; delete n[url]; return n; }); } };

  const pick = async (file?: File) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { URL.revokeObjectURL(url); return alert("That image could not be read."); }
    drop(current.image);
    setImages(m => ({ ...m, [url]: img }));
    patch({ image: url, layout: wantsImage(current.layout) ? current.layout : "imageRight" });
  };

  const reset = () => {
    deck.slides.forEach(s => drop(s.image));
    const fresh = newDeck();
    setDeck(fresh); setCurrentId(fresh.slides[0].id);
  };

  const create = async () => {
    setBusy(true);
    try {
      for (const { file, title } of await deckFiles(deck, images)) await onCreate(file, title);
      reset();
      onClose();
    } catch (e) { alert(`Could not make that deck: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <Modal isOpen={open} onOpenChange={v => { if (!v) onClose(); }}>
      <ModalContent>
        <ModalHeader>New deck</ModalHeader>
        <ModalBody>
          <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
            {/* The deck. Order here is the order the cues land in the library. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{deck.slides.length} slide{deck.slides.length === 1 ? "" : "s"}</span>
                <Switch size="sm" isSelected={strip.reorder} onValueChange={strip.setReorder}>Reorder</Switch>
              </div>
              <ol ref={strip.list} className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                {order.map((s, i) => (
                  <li key={s.id} className={`flex items-center gap-1 rounded-xl border p-1 ${s.id === current.id ? "border-accent bg-accent/10" : strip.drag?.to === i ? "border-accent" : "border-border bg-surface/40"}`}>
                    {/* touch-action explicit both ways, same rule as the cue deck: pan-y hands the
                        scroll back unless the finger holds still, none claims it in reorder mode. */}
                    <span role="button" tabIndex={-1} aria-label={`Reorder slide ${i + 1}`}
                      className={`flex min-w-8 shrink-0 cursor-grab items-center justify-center self-stretch text-muted active:cursor-grabbing ${strip.reorder ? "touch-none text-accent" : "touch-pan-y"}`}
                      onPointerDown={strip.start(i)} onPointerMove={strip.move} onPointerUp={strip.end} onPointerCancel={strip.end}>
                      <GripVertical size={14} aria-hidden />
                    </span>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setCurrentId(s.id)}>
                      <Thumb master={deck.master} slide={s} img={s.image ? images[s.image] : null} />
                      <span className="mt-1 block truncate text-[11px] text-muted">{i + 1}. {slideName(s, i)}</span>
                    </button>
                    <Button isIconOnly size="sm" variant="light" color="danger" aria-label={`Delete slide ${i + 1}`}
                      isDisabled={deck.slides.length < 2}
                      onPress={() => {
                        drop(s.image);
                        const next = removeSlide(deck, s.id);
                        setDeck(next);
                        if (s.id === current.id) setCurrentId(next.slides[Math.min(at, next.slides.length - 1)].id);
                      }}>
                      <Trash2 size={13} />
                    </Button>
                  </li>
                ))}
              </ol>
              <Button size="sm" variant="flat" color="primary" className="w-full" startContent={<Plus size={14} />}
                onPress={() => { const next = addSlide(deck, at, current.layout); setDeck(next); setCurrentId(next.slides[at + 1].id); }}>
                Add slide
              </Button>
            </div>

            {/* The slide under the cursor. */}
            <div className="space-y-3">
              <canvas ref={canvas} className="w-full rounded-xl border border-border bg-black" />
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted">
                  Layout
                  <select aria-label="Slide layout" value={current.layout} onChange={e => patch({ layout: e.target.value as Layout })}
                    className="ml-2 rounded-lg border border-border bg-surface/60 px-2 py-1 text-sm text-foreground outline-none focus:border-accent">
                    {LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm hover:border-accent">
                  <ImagePlus size={14} />{current.image ? "Replace image" : "Image"}
                  <input type="file" accept="image/*" className="hidden" onChange={e => void pick(e.target.files?.[0])} />
                </label>
                {current.image && (
                  <Button size="sm" variant="light" startContent={<X size={13} />} onPress={() => { drop(current.image); patch({ image: undefined }); }}>Clear image</Button>
                )}
                {wantsImage(current.layout) && !current.image && <span className="text-xs text-muted">This layout wants an image.</span>}
              </div>
              <Input label="Title" value={current.title} onValueChange={v => patch({ title: v })} placeholder="Act two" />
              {current.layout !== "image" && (
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">
                    {current.layout === "title" ? "Standfirst" : "Lines (one per row, a blank row leaves a gap)"}
                  </span>
                  <textarea rows={3} value={current.body} onChange={e => patch({ body: e.target.value })}
                    placeholder={"House to half\nStandby sound 4"}
                    className="w-full resize-y rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-accent" />
                </label>
              )}

              {/* The master. One theme for the deck, which is the point of having a deck. */}
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <span className="text-xs text-muted">Master</span>
                {THEMES.map(t => (
                  <button key={t.name} type="button" onClick={() => master({ bg: t.bg, fg: t.fg, accent: t.accent })}
                    aria-label={t.name} title={t.name}
                    className={`h-8 w-8 rounded-full border-2 ${deck.master.bg === t.bg ? "border-accent" : "border-border"}`}
                    style={{ background: `linear-gradient(135deg, ${t.bg} 60%, ${t.accent} 60%)` }} />
                ))}
                <Button size="sm" variant={deck.master.align === "left" ? "solid" : "flat"} color={deck.master.align === "left" ? "primary" : "default"}
                  isIconOnly aria-label="Align left" onPress={() => master({ align: "left" })}><AlignLeft size={15} /></Button>
                <Button size="sm" variant={deck.master.align === "center" ? "solid" : "flat"} color={deck.master.align === "center" ? "primary" : "default"}
                  isIconOnly aria-label="Align centre" onPress={() => master({ align: "center" })}><AlignCenter size={15} /></Button>
                <Switch size="sm" isSelected={deck.master.bullets} onValueChange={b => master({ bullets: b })}>Bullets</Switch>
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Cancel</Button>
          <Button color="primary" isLoading={busy} onPress={create}>
            Add {deck.slides.length === 1 ? "slide" : `${deck.slides.length} slides`} to library
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/** Same painter as the export, one tenth the size. */
function Thumb({ master, slide, img }: { master: Master; slide: Slide; img: Img }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawSlide(ref.current, master, slide, img, 192); }, [master, slide, img]);
  return <canvas ref={ref} className="w-full rounded-md border border-border" />;
}
