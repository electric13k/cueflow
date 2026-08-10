import { useEffect, useRef, useState } from "react";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import { Button, Tooltip } from "../ui";
import { Check, Crop, FlipHorizontal, RotateCcw, RotateCw, Undo2, X } from "lucide-react";

const RATIOS: { label: string; hint: string; value: number }[] = [
  { label: "Free", hint: "Any shape", value: NaN },
  { label: "16:9", hint: "Widescreen, the shape of most projectors", value: 16 / 9 },
  { label: "4:3", hint: "The older projector shape", value: 4 / 3 },
  { label: "1:1", hint: "Square", value: 1 },
  { label: "9:16", hint: "Upright, for a phone or a tall screen", value: 9 / 16 },
];

/**
 * Crop and rotate, on Cropper.js (github.com/fengyuanchen/cropperjs, MIT). The library owns the
 * box, the handles, the ratio lock and the pixel readback; this component owns the buttons and
 * hands the result out as a file.
 *
 * The rotation is baked by `getCroppedCanvas`, so a turned picture leaves as a turned file rather
 * than as a CSS transform the presenter would have to reapply.
 */
export default function CropBox({ url, title, onCancel, onApply }: {
  url: string; title: string; onCancel: () => void; onApply: (file: File) => void;
}) {
  const img = useRef<HTMLImageElement>(null);
  const cropper = useRef<Cropper | null>(null);
  const [ratio, setRatio] = useState(NaN);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = img.current; if (!el) return;
    // Without this the canvas is tainted by a cross-origin file and getCroppedCanvas throws.
    el.crossOrigin = "anonymous";
    const c = new Cropper(el, {
      viewMode: 1, autoCropArea: 1, background: false, responsive: true,
      ready: () => setReady(true),
    });
    cropper.current = c;
    return () => { c.destroy(); cropper.current = null; setReady(false); };
  }, [url]);

  const pick = (v: number) => { setRatio(v); cropper.current?.setAspectRatio(v); };
  const turn = (deg: number) => cropper.current?.rotate(deg);
  const mirror = () => cropper.current?.scaleX(-(cropper.current.getData().scaleX || 1));
  const reset = () => { cropper.current?.reset(); pick(NaN); };

  const done = () => {
    const c = cropper.current; if (!c) return;
    setBusy(true);
    // maxWidth keeps a 40 megapixel phone photo from turning into a canvas the tab cannot allocate.
    c.getCroppedCanvas({ maxWidth: 4096, maxHeight: 4096, imageSmoothingQuality: "high" })
      .toBlob(blob => {
        setBusy(false);
        if (!blob) return alert("That crop could not be rendered.");
        onApply(new File([blob], `${title}.png`, { type: "image/png" }));
      }, "image/png");
  };

  return (
    <div className="space-y-3">
      <div className="max-h-[60vh] overflow-hidden rounded-2xl border border-border bg-black">
        {/* Cropper replaces this element with its own scaffold, so it needs a plain img and no layout of ours. */}
        <img ref={img} src={url} alt="" className="block max-w-full" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Crop size={15} className="text-muted" />
        {RATIOS.map(r => (
          <Tooltip key={r.label} content={r.hint}>
            <Button size="sm" variant={Object.is(ratio, r.value) ? "solid" : "flat"} color={Object.is(ratio, r.value) ? "primary" : "default"}
              onPress={() => pick(r.value)}>{r.label}</Button>
          </Tooltip>
        ))}
        <Tooltip content="Turn a quarter left">
          <Button isIconOnly size="sm" variant="flat" aria-label="Rotate left" onPress={() => turn(-90)}><RotateCcw size={15} /></Button>
        </Tooltip>
        <Tooltip content="Turn a quarter right">
          <Button isIconOnly size="sm" variant="flat" aria-label="Rotate right" onPress={() => turn(90)}><RotateCw size={15} /></Button>
        </Tooltip>
        <Tooltip content="Mirror left to right">
          <Button isIconOnly size="sm" variant="flat" aria-label="Mirror" onPress={mirror}><FlipHorizontal size={15} /></Button>
        </Tooltip>
        <Tooltip content="Put the box, the turn and the mirror back where they started">
          <Button isIconOnly size="sm" variant="light" aria-label="Reset" onPress={reset}><Undo2 size={15} /></Button>
        </Tooltip>
        <span className="text-xs text-muted">Drag inside the picture to move the box, drag an edge to resize it.</span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="light" startContent={<X size={14} />} onPress={onCancel}>Cancel</Button>
          <Tooltip content="Writes the framed part out as a new image in the library">
            <span>
              <Button size="sm" color="primary" isDisabled={!ready} isLoading={busy} startContent={<Check size={14} />} onPress={done}>
                Crop to new image
              </Button>
            </span>
          </Tooltip>
        </span>
      </div>
    </div>
  );
}
