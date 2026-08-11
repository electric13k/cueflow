/**
 * The mark: the supplied CF monogram, a Didone C and F sharing one silhouette between house tabs,
 * with a clapper behind them.
 *
 * It is a raster, not a drawing, so this is an `<img>` rather than inline SVG. `public/brand/cf-dark.png`
 * is the master at 1024, and `scripts/icons.mjs` cuts the favicon, the touch icon and the social card
 * from that same file so nothing drifts. `cf-light.png` is the cream-ground version, for anywhere the
 * mark has to sit on maroon.
 */
const SRC = `${import.meta.env.BASE_URL}brand/cf-dark.png`;

export default function LogoMark({ size = 40, className = "", title }: { size?: number; className?: string; title?: string }) {
  return (
    <img src={SRC} width={size} height={size} alt={title ?? ""} aria-hidden={title ? undefined : true}
      // The art is a full-bleed square; the radius is what makes it read as a plaque next to the
      // wordmark rather than a photograph someone dropped into the bar.
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }}
      className={`shrink-0 object-cover ${className}`} />
  );
}
