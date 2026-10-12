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
  "cedar-dinner": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#282f2d", stamp: "f2284cd2" },
  "family-cottage-detail": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#393a39", stamp: "1a2e5dd3" },
  "family-cottage-inside": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#453a30", stamp: "6325bf1f" },
  "family-cottage": { width: 2000, height: 1500, widths: [480, 800, 1200, 1600], colour: "#5c645f", stamp: "cb784088" },
  "forest-cottage-detail": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#444949", stamp: "b5e01d6e" },
  "forest-cottage-inside": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#332620", stamp: "ba56a85c" },
  "forest-cottage": { width: 2000, height: 1500, widths: [480, 800, 1200, 1600], colour: "#3a433f", stamp: "b607d530" },
  "forest-walk": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#3f4c4a", stamp: "2281adb4" },
  "game-drive": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#757c83", stamp: "c18a32dc" },
  "horse-ride": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#a4b1b7", stamp: "a3ddd404" },
  "lodge-evening": { width: 2400, height: 1350, widths: [480, 800, 1200, 1600], colour: "#425058", stamp: "398d14d3" },
  "mountain-tent-detail": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#3d4244", stamp: "2f474c89" },
  "mountain-tent-inside": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#493f40", stamp: "090be0d3" },
  "mountain-tent": { width: 2000, height: 1500, widths: [480, 800, 1200, 1600], colour: "#535c5c", stamp: "06bf4642" },
  "nanyuki-transfer": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#515a5f", stamp: "8c7f0e90" },
  "the-road": { width: 1800, height: 1200, widths: [480, 800, 1200, 1600], colour: "#525853", stamp: "097d0a9d" },
  "ukingo-house-detail": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#373230", stamp: "ed538fd9" },
  "ukingo-house-inside": { width: 1600, height: 1200, widths: [480, 800, 1200, 1600], colour: "#34312b", stamp: "949b1015" },
  "ukingo-house": { width: 2000, height: 1500, widths: [480, 800, 1200, 1600], colour: "#505955", stamp: "9438a70a" },
};
