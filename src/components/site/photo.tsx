import { builtIn, pictureAddress, type Picture } from "@/photos/picture";

import { Mark } from "./logo";

/**
 * Past about twice the density of an ordinary screen, more pixels in a
 * photograph cannot be seen, only paid for in data. Phones with three pixels
 * to the point would otherwise fetch a file over twice the weight. So each
 * width in `sizes` is offered again at two thirds, for very dense screens only.
 */
function sparing(sizes: string): string {
  return sizes
    .split(",")
    .map((part) => part.trim())
    .flatMap((part) => {
      const [, when, width] = /^(.*?)\s*(\d+(?:\.\d+)?)vw$/.exec(part) ?? [];
      if (!width) return [part];
      const dense = "(min-resolution: 2.5dppx)";
      return [`${when ? `${when} and ${dense}` : dense} ${Math.round(Number(width) * 0.67)}vw`, part];
    })
    .join(", ");
}

/**
 * A photograph, served at the size the screen needs and in the newest format
 * the browser understands. `sizes` says how wide it is drawn at each screen
 * width, so a phone never downloads the laptop's copy. It is described by its
 * own description, or by `alt` where it has none.
 *
 * Give `name` for a photograph the site was built with, or `picture` for one
 * that may have been put up from the back office (null when there is none).
 */
export function Photo({
  name,
  picture,
  alt,
  sizes,
  className = "",
  priority = false,
}: {
  alt: string;
  sizes: string;
  className?: string;
  /** For the one photograph at the top of a page: load it first. */
  priority?: boolean;
} & ({ name: string; picture?: never } | { picture: Picture | null; name?: never })) {
  const photo = picture === undefined ? builtIn(name ?? "") : picture;

  if (!photo) {
    // No photograph yet. A quiet panel in the site's colours stands in.
    return (
      <div
        role="img"
        aria-label={alt}
        className={`contours flex items-center justify-center bg-night-800 text-night-400 ${className}`}
      >
        <Mark className="size-12 opacity-60" />
      </div>
    );
  }

  // Each address changes when the photograph does, which lets browsers keep each copy for good.
  const file = (width: number, format: "avif" | "webp" | "jpg") => pictureAddress(photo, width, format);
  const set = (format: "avif" | "webp" | "jpg") =>
    photo.widths.map((width) => `${file(width, format)} ${width}w`).join(", ");
  const largest = photo.widths[photo.widths.length - 1];
  const fitted = sparing(sizes);

  return (
    <picture>
      {photo.formats.includes("avif") ? <source type="image/avif" srcSet={set("avif")} sizes={fitted} /> : null}
      {photo.formats.includes("webp") ? <source type="image/webp" srcSet={set("webp")} sizes={fitted} /> : null}
      <img
        src={file(largest, "jpg")}
        srcSet={set("jpg")}
        sizes={fitted}
        alt={photo.description ?? alt}
        width={photo.width}
        height={photo.height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding={priority ? "sync" : "async"}
        style={{ backgroundColor: photo.colour }}
        className={`object-cover ${className}`}
      />
    </picture>
  );
}
