// The photographs the site can show, and the sizes each was prepared in.
// Written by scripts/photos.mjs from the originals. Do not edit by hand.

export type PhotoRecord = {
  /** Width over height of the original. */
  width: number;
  height: number;
  /** The widths, in pixels, the photograph was saved at. */
  widths: number[];
  /** A dominant colour, shown while the photograph loads. */
  colour: string;
};

export const photos: Record<string, PhotoRecord> = {};
