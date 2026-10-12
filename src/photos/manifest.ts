// The photographs the site can show, and the sizes each was prepared in.
// Written by scripts/photos.mjs from the originals. Do not edit by hand.

export type PhotoRecord = {
  /** Width over height of the original. */
  width: number;
  height: number;
  /** The widths, in pixels, the photograph was saved at. */
  widths: number[];
  /** Its average colour, shown while the photograph loads. */
  colour: string;
  /** Changes when the photograph does, so a browser never shows an old copy. */
  stamp: string;
};

export const photos: Record<string, PhotoRecord> = {
  "cedar-dinner": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#282f2d", stamp: "038a09eb" },
  "family-cottage-detail": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#393a39", stamp: "04071f2d" },
  "family-cottage-inside": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#453a30", stamp: "88f00ceb" },
  "family-cottage": { width: 2000, height: 1500, widths: [480, 800, 1200, 1600], colour: "#5c645f", stamp: "070d576d" },
  "forest-cottage-detail": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#444949", stamp: "01302eb0" },
  "forest-cottage-inside": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#332620", stamp: "cd0fbaed" },
  "forest-cottage": { width: 2000, height: 1500, widths: [480, 800, 1200, 1600], colour: "#3a433f", stamp: "8b829a2f" },
  "forest-walk": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#3f4c4a", stamp: "2e1cd699" },
  "game-drive": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#757c83", stamp: "24cf0ed5" },
  "horse-ride": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#a4b1b7", stamp: "2a13dd4f" },
  "lodge-evening": { width: 2400, height: 1350, widths: [480, 800, 1200, 1600], colour: "#425058", stamp: "13b42b84" },
  "mountain-tent-detail": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#3d4244", stamp: "8b19bf82" },
  "mountain-tent-inside": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#493f40", stamp: "2a23a997" },
  "mountain-tent": { width: 2000, height: 1500, widths: [480, 800, 1200, 1600], colour: "#535c5c", stamp: "18497c58" },
  "nanyuki-transfer": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#515a5f", stamp: "ce2e0083" },
  "the-road": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#525853", stamp: "e1970a51" },
  "ukingo-house-detail": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#373230", stamp: "4b82007d" },
  "ukingo-house-inside": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#34312b", stamp: "24516c44" },
  "ukingo-house": { width: 2000, height: 1500, widths: [480, 800, 1200, 1600], colour: "#505955", stamp: "7bc5de09" },
};
