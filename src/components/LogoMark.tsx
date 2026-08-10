import { useId } from "react";

/**
 * The mark: a C that is also a proscenium arch, with a lantern hung at the crown and its beam
 * falling on the stage the counter encloses. Four shapes on purpose, since a fifth turns to dirt at
 * 16px, and the same geometry is what `public/favicon.svg` and every generated icon are cut from.
 */
export default function LogoMark({ size = 40, className, title }: { size?: number; className?: string; title?: string }) {
  // Two marks on one page would otherwise share a clip id, and the second would clip against the first.
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className}
      role={title ? "img" : "presentation"} aria-hidden={title ? undefined : true} aria-label={title}>
      {title && <title>{title}</title>}
      <rect width="64" height="64" rx="14" fill="#F3E9D8" />
      <clipPath id={id}><circle cx="32" cy="32" r="15" /></clipPath>
      <g clipPath={`url(#${id})`}>
        <path d="M29 17 L46 44 L20 44 Z" fill="#46583A" opacity=".8" />
        <rect x="14" y="43" width="36" height="4.5" fill="#6E2029" />
      </g>
      <path d="M44.01 16.63 A19.5 19.5 0 1 0 44.01 47.37" fill="none" stroke="#6E2029" strokeWidth="9" />
      <rect x="25" y="13.2" width="9" height="4.6" rx="1.6" fill="#2B2420" />
    </svg>
  );
}
