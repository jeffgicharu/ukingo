import { photos } from "@/photos/manifest";

import { Mark } from "./logo";

/**
 * A photograph, served at the size the screen needs and in the newest format
 * the browser understands. `sizes` says how wide it is drawn at each screen
 * width, so a phone never downloads the laptop's copy.
 */
export function Photo({
  name,
  alt,
  sizes,
  className = "",
  priority = false,
}: {
  name: string;
  alt: string;
  sizes: string;
  className?: string;
  /** For the one photograph at the top of a page: load it first. */
  priority?: boolean;
}) {
  const photo = photos[name];

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

  const set = (format: string) =>
    photo.widths.map((width) => `/photos/${name}-${width}.${format} ${width}w`).join(", ");
  const largest = photo.widths[photo.widths.length - 1];

  return (
    <picture>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={set("webp")} sizes={sizes} />
      <img
        src={`/photos/${name}-${largest}.jpg`}
        srcSet={set("jpg")}
        sizes={sizes}
        alt={alt}
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
