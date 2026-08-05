import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch } from "../ui";
import { AlignCenter, AlignLeft } from "lucide-react";
import { defaultSlide, drawSlide, slideFile, type Slide } from "../lib/image";

/** Backgrounds that stay legible from the back of a room, and a matching accent for each. */
const THEMES: { name: string; bg: string; fg: string; accent: string }[] = [
  { name: "House", bg: "#1A1614", fg: "#EFE7D8", accent: "#C9737C" },
  { name: "Foolscap", bg: "#EFE7D8", fg: "#241F1C", accent: "#6E2029" },
  { name: "Curtain", bg: "#3A0F14", fg: "#F3E2D6", accent: "#D4A957" },
  { name: "Olive", bg: "#2A2E22", fg: "#EFE7D8", accent: "#A3B37A" },
  { name: "Brass", bg: "#241F1C", fg: "#F5E9D4", accent: "#D4A957" },
  { name: "Blackout", bg: "#000000", fg: "#FFFFFF", accent: "#A32330" },
];

/**
 * Types a slide and hands back a PNG. One layout, a few knobs -- title, lines, theme, alignment --
 * following the pptWeb editor (github.com/theBigGavin/pptWeb), whose default slide this borrows.
 * A deck built during a tech rehearsal needs to be readable, not art-directed.
 */
export default function SlideComposer({ open, onClose, onCreate }: {
  open: boolean; onClose: () => void; onCreate: (file: File, title: string) => Promise<void>;
}) {
  const [slide, setSlide] = useState<Slide>(defaultSlide());
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const set = (patch: Partial<Slide>) => setSlide(s => ({ ...s, ...patch }));

  useEffect(() => { if (open && canvas.current) drawSlide(canvas.current, slide); }, [open, slide]);

  const create = async () => {
    setBusy(true);
    try {
      const name = slide.title.trim() || "Slide";
      await onCreate(await slideFile(slide, name), name);
      setSlide(defaultSlide());
      onClose();
    } catch (e) { alert(`Could not make that slide: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <Modal isOpen={open} onOpenChange={v => { if (!v) onClose(); }}>
      <ModalContent>
        <ModalHeader>New slide</ModalHeader>
        <ModalBody>
          <div className="space-y-4">
          <canvas ref={canvas} className="w-full rounded-xl border border-border bg-black" />
          <Input label="Title" value={slide.title} onValueChange={v => set({ title: v })} placeholder="Act two" />
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Lines (one per row, a blank row leaves a gap)</span>
            <textarea rows={4} value={slide.body} onChange={e => set({ body: e.target.value })}
              placeholder={"House to half\nStandby sound 4"}
              className="w-full resize-y rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-accent" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {THEMES.map(t => (
              <button key={t.name} type="button" onClick={() => set({ bg: t.bg, fg: t.fg, accent: t.accent })}
                aria-label={t.name} title={t.name}
                className={`h-9 w-9 rounded-full border-2 ${slide.bg === t.bg ? "border-accent" : "border-border"}`}
                style={{ background: `linear-gradient(135deg, ${t.bg} 60%, ${t.accent} 60%)` }} />
            ))}
            <Button size="sm" variant={slide.align === "left" ? "solid" : "flat"} color={slide.align === "left" ? "primary" : "default"}
              isIconOnly onPress={() => set({ align: "left" })}><AlignLeft size={15} /></Button>
            <Button size="sm" variant={slide.align === "center" ? "solid" : "flat"} color={slide.align === "center" ? "primary" : "default"}
              isIconOnly onPress={() => set({ align: "center" })}><AlignCenter size={15} /></Button>
            <Switch size="sm" isSelected={slide.bullets} onValueChange={b => set({ bullets: b })}>Bullets</Switch>
          </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Cancel</Button>
          <Button color="primary" isLoading={busy} onPress={create}>Add to library</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
