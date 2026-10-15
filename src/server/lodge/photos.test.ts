import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { copyHeight } from "@/photos/picture";
import { fieldsOf, setupAction, SetupError, type SetupActionName } from "@/server/desk/setup";
import { db, schema } from "@/server/db";
import { NotAllowed, type Staff } from "@/server/staff/permissions";
import { freshLodge } from "@/testing/lodge";

import { forgetCatalogue, loadCatalogue, roomTypeBySlug } from "./catalogue";
import { bareJpeg, checkCopies, jpegSize, keepPhoto, readPhotoFile, webpSize, type Copy } from "./photo-files";

let folder: string;
let owner: Staff;
let manager: Staff;
let desk: Staff;
let trainee: Staff;

/** One copy as a browser would make it: a gradient, so it has something in it. */
async function copy(format: "jpg" | "webp", width: number, height = copyHeight(width), place = false) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let at = 0; at < pixels.length; at += 3) {
    pixels[at] = ((at / 3) % width) % 256;
    pixels[at + 1] = Math.floor(at / 3 / width) % 256;
    pixels[at + 2] = 90;
  }
  let image = sharp(pixels, { raw: { width, height, channels: 3 } });
  // Where it was taken, as a phone writes it.
  if (place) image = image.withMetadata({ exif: { IFD3: { GPSLatitudeRef: "S", GPSLatitude: "0/1 3/1 0/1" } } });
  return new Uint8Array(await (format === "jpg" ? image.jpeg() : image.webp()).toBuffer());
}

/** Every copy of one photograph, as the form sends them. */
async function copies(widths = [480, 800, 1200, 1600], webp = true): Promise<Copy[]> {
  const all: Copy[] = [];
  for (const width of widths) {
    all.push({ format: "jpg", width, bytes: await copy("jpg", width) });
    if (webp) all.push({ format: "webp", width, bytes: await copy("webp", width) });
  }
  return all;
}

const asFields = (list: Copy[]) =>
  Object.fromEntries(list.map((one) => [`${one.format}-${one.width}`, new File([new Uint8Array(one.bytes)], "copy")]));

async function saved(): Promise<string[]> {
  try {
    return (await readdir(path.join(folder, "photos"))).sort();
  } catch {
    return [];
  }
}

async function member(name: string, role: Staff["role"], training = false): Promise<Staff> {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@ukingo.test`;
  const [row] = await db()
    .insert(schema.staff)
    .values({ name, email, passwordHash: "x", role, training })
    .returning({ id: schema.staff.id });
  return { id: row.id, name, email, role, training };
}

/** Puts a change through the way the screens do: read the form, then apply what was read. */
async function change(name: SetupActionName, values: Record<string, string | Blob>, staff: Staff): Promise<string> {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  const action = setupAction(name);
  const proposal = await action.read(fieldsOf(form));
  return action.apply(proposal, staff, new Date());
}

beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "ukingo-photos-"));
  process.env.MEDIA_DIR = folder;
});

afterAll(async () => {
  delete process.env.MEDIA_DIR;
  await rm(folder, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(path.join(folder, "photos"), { recursive: true, force: true });
  await freshLodge();
  owner = await member("Ada Owner", "owner");
  manager = await member("Moraa Manager", "reservations");
  desk = await member("Kip Desk", "front_desk");
  trainee = await member("Training Manager", "reservations", true);
});

describe("reading a copy without an image library", () => {
  it("finds the size of a JPEG and a WebP, and nothing in what is neither", async () => {
    expect(jpegSize(await copy("jpg", 800))).toEqual({ width: 800, height: 600 });
    expect(webpSize(await copy("webp", 480))).toEqual({ width: 480, height: 360 });
    const lossless = new Uint8Array(
      await sharp(await copy("jpg", 480))
        .webp({ lossless: true })
        .toBuffer(),
    );
    expect(webpSize(lossless)).toEqual({ width: 480, height: 360 });

    expect(jpegSize(await copy("webp", 480))).toBeNull();
    expect(webpSize(await copy("jpg", 480))).toBeNull();
    expect(jpegSize(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(webpSize(new Uint8Array(40))).toBeNull();
  });

  it("takes out of a JPEG where it was taken, and leaves the picture", async () => {
    const withPlace = await copy("jpg", 800, 600, true);
    expect((await sharp(withPlace).metadata()).exif).toBeDefined();

    const bare = bareJpeg(withPlace);
    const meta = await sharp(bare).metadata();
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([800, 600]);
    // Still the same picture.
    const [before, after] = await Promise.all([withPlace, bare].map((bytes) => sharp(bytes).raw().toBuffer()));
    expect(after.equals(before)).toBe(true);
  });
});

describe("checking the copies a browser made", () => {
  it("accepts a JPEG at each width from the smallest up, with or without a WebP beside every one", async () => {
    expect(checkCopies(await copies())).toHaveLength(8);
    expect(checkCopies(await copies([480, 800, 1200], false))).toHaveLength(3);
  });

  it("refuses a set with a width missing, or WebPs beside only some", async () => {
    const whole = "The photograph did not arrive whole. Please choose it and put it up again.";
    expect(() => checkCopies([])).toThrow(whole);
    const all = await copies();
    expect(() => checkCopies(all.filter((one) => one.width !== 800))).toThrow(whole);
    expect(() => checkCopies(all.filter((one) => !(one.format === "webp" && one.width === 1600)))).toThrow(whole);
    expect(() => checkCopies(all.filter((one) => one.width === 480))).toThrow(whole);
  });

  it("refuses a copy that is not what it claims, or not the size it should be", async () => {
    const all = await copies([480, 800, 1200], false);
    const wrong = "The photograph was not made ready as this site needs. Please try again in another browser.";
    // A WebP sent as a JPEG.
    const swapped = all.map((one) => (one.width === 800 ? { ...one, bytes: Buffer.from(all[0].bytes) } : one));
    expect(() => checkCopies(swapped)).toThrow(wrong);
    // The right kind of file, the wrong shape.
    const squashed = await copy("jpg", 800, 500);
    expect(() => checkCopies(all.map((one) => (one.width === 800 ? { ...one, bytes: squashed } : one)))).toThrow(wrong);
    // Not a picture at all.
    const script = new TextEncoder().encode("<script>alert(1)</script>");
    expect(() => checkCopies(all.map((one) => (one.width === 480 ? { ...one, bytes: script } : one)))).toThrow(wrong);
  });

  it("keeps the copies under a new name, and serves only copies by their exact names", async () => {
    const kept = await keepPhoto("forest-cottage-main", await copies());
    expect(kept).toMatchObject({ width: 1600, height: 1200, widths: [480, 800, 1200, 1600], formats: ["webp", "jpg"] });
    expect(kept.file).toMatch(/^forest-cottage-main-[0-9a-f]{10}$/);
    expect(await saved()).toHaveLength(8);

    expect((await readPhotoFile(`${kept.file}-480.webp`))?.type).toBe("image/webp");
    expect((await readPhotoFile(`${kept.file}-1600.jpg`))?.type).toBe("image/jpeg");
    expect(await readPhotoFile(`${kept.file}-1600.avif`)).toBeNull();
    expect(await readPhotoFile(`${kept.file}-481.jpg`)).toBeNull();
    expect(await readPhotoFile("../env")).toBeNull();
    expect(await readPhotoFile(`..%2F${kept.file}-480.jpg`)).toBeNull();
  });
});

describe("putting up the photographs of a room", () => {
  const described = "The cottage from the lawn, smoke rising from the chimney";

  it("shows a new photograph in its place on the site, and takes the one it replaced off the server", async () => {
    const cottage = roomTypeBySlug(await loadCatalogue(), "forest-cottage")!;
    expect(cottage.photos.main?.base).toBe("/photos/forest-cottage");
    const where = { type: String(cottage.id), place: "main", description: described };

    const said = await change("photo-add", { ...where, colour: "#3A4B5C", ...asFields(await copies()) }, manager);
    expect(said).toBe("The new main photograph of Forest Cottage is up on the site.");

    forgetCatalogue();
    const first = roomTypeBySlug(await loadCatalogue(), "forest-cottage")!.photos.main!;
    expect(first).toMatchObject({
      width: 1600,
      height: 1200,
      formats: ["webp", "jpg"],
      colour: "#3a4b5c",
      description: described,
      version: "",
    });
    expect(first.base).toMatch(/^\/uploads\/forest-cottage-main-[0-9a-f]{10}$/);
    // The other two places keep the photographs the site was built with.
    expect(roomTypeBySlug(await loadCatalogue(), "forest-cottage")!.photos.inside?.base).toBe(
      "/photos/forest-cottage-inside",
    );

    // From a browser that cannot make a WebP, and with no colour said.
    await change("photo-add", { ...where, ...asFields(await copies([480, 800, 1200], false)) }, owner);
    forgetCatalogue();
    const second = roomTypeBySlug(await loadCatalogue(), "forest-cottage")!.photos.main!;
    expect(second).toMatchObject({ width: 1200, height: 900, formats: ["jpg"], widths: [480, 800, 1200] });
    expect(second.colour).toMatch(/^#[0-9a-f]{6}$/);
    const names = await saved();
    expect(names).toHaveLength(3);
    expect(names.every((name) => name.startsWith(second.base.slice("/uploads/".length)))).toBe(true);
  });

  it("changes a description, and puts back the original with nothing left behind", async () => {
    const tent = roomTypeBySlug(await loadCatalogue(), "mountain-tent")!;
    const where = { type: String(tent.id), place: "detail" };
    await change("photo-add", { ...where, description: described, ...asFields(await copies()) }, owner);

    expect(await change("photo-describe", { ...where, description: "The copper bath at first light" }, owner)).toBe(
      "The description of the detail photograph of Mountain Tent is saved.",
    );
    forgetCatalogue();
    expect(roomTypeBySlug(await loadCatalogue(), "mountain-tent")!.photos.detail?.description).toBe(
      "The copper bath at first light",
    );

    expect(await change("photo-remove", where, owner)).toBe(
      "The detail photograph of Mountain Tent is back to the one the site was built with.",
    );
    forgetCatalogue();
    expect(roomTypeBySlug(await loadCatalogue(), "mountain-tent")!.photos.detail?.base).toBe(
      "/photos/mountain-tent-detail",
    );
    expect(await saved()).toEqual([]);
    await expect(change("photo-describe", { ...where, description: "Anything at all here" }, owner)).rejects.toThrow(
      "That photograph has been taken down.",
    );
  });

  it("says what is needed when the form arrives without copies, and saves nothing", async () => {
    const cottage = roomTypeBySlug(await loadCatalogue(), "forest-cottage")!;
    const where = { type: String(cottage.id), place: "inside", description: described };
    // A browser with scripts switched off sends the photograph as it was chosen.
    await expect(
      change("photo-add", { ...where, photo: new File([new Uint8Array(await copy("jpg", 2000))], "a.jpg") }, owner),
    ).rejects.toThrow("Putting up a photograph needs scripts switched on in this browser");
    await expect(change("photo-add", where, owner)).rejects.toThrow("Choose a photograph to put up.");
    await expect(
      change("photo-add", { ...where, description: "Bed", ...asFields(await copies()) }, owner),
    ).rejects.toBeInstanceOf(SetupError);
    await expect(change("photo-add", { ...where, place: "roof", ...asFields(await copies()) }, owner)).rejects.toThrow(
      "Choose where the photograph goes.",
    );
    await expect(
      change("photo-add", { ...where, ...asFields((await copies()).filter((one) => one.width !== 1200)) }, owner),
    ).rejects.toThrow("did not arrive whole");
    expect(await saved()).toEqual([]);
    expect(await db().select().from(schema.roomPhotos)).toEqual([]);
  });

  it("is refused to the front desk and to training accounts, where the data is changed", async () => {
    const cottage = roomTypeBySlug(await loadCatalogue(), "forest-cottage")!;
    const values = { type: String(cottage.id), place: "main", description: described, ...asFields(await copies()) };
    await expect(change("photo-add", values, desk)).rejects.toBeInstanceOf(NotAllowed);
    await expect(change("photo-add", values, trainee)).rejects.toThrow(/Training accounts/);
    await expect(change("photo-remove", { type: String(cottage.id), place: "main" }, trainee)).rejects.toBeInstanceOf(
      NotAllowed,
    );
    expect(await saved()).toEqual([]);
  });
});
