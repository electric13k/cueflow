import { Share2 } from "lucide-react";
import { Button } from "../ui";
import { toast } from "../lib/toast";

type Props = {
  url: string;
  title: string;
  text?: string;
  size?: "sm" | "md" | "lg";
  variant?: "flat" | "light" | "bordered" | "solid";
  label?: string;
  className?: string;
  iconOnly?: boolean;
};

async function copy(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

/** Uses the phone's share sheet where available, and always leaves desktop with a usable URL. */
export default function ShareButton({ url, title, text, size = "sm", variant = "light", label = "Share", className = "", iconOnly = false }: Props) {
  const share = async () => {
    const absolute = new URL(url, location.href).href;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: text ?? title, url: absolute });
        return;
      }
      await copy(absolute);
      toast("Link copied", "Anyone with access can open this CueFlow link.", "success");
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      try {
        await copy(absolute);
        toast("Link copied", "The share sheet was unavailable, so the link is on your clipboard.", "success");
      } catch {
        toast("Could not share", "Copy the URL from your browser and send it instead.", "warn");
      }
    }
  };

  return <Button size={size} variant={variant} className={className} startContent={iconOnly ? undefined : <Share2 size={14} />} isIconOnly={iconOnly} aria-label={iconOnly ? label : undefined} onPress={(event: any) => { event?.stopPropagation?.(); void share(); }}>{iconOnly ? <Share2 size={14} /> : label}</Button>;
}
