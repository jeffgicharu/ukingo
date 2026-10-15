import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fieldsOf, setupAction, SetupError, type SetupActionName } from "@/server/desk/setup";
import { db, schema } from "@/server/db";
import { NotAllowed, type Staff } from "@/server/staff/permissions";
import { freshLodge } from "@/testing/lodge";

import { forgetCatalogue, loadCatalogue, roomTypeBySlug } from "./catalogue";
import { readPhotoFile } from "./photo-files";
import { preparePhotoApart } from "./photo-preparing";
import { preparePhoto } from "./photos";

let folder: string;
let owner: Staff;
let manager: Staff;
let desk: Staff;
let trainee: Staff;

/** A photograph made for the test: a gradient, so every copy has something in it. */
async function photograph(
  width: number,
  height: number,
  options: { format?: "jpeg" | "png" | "webp"; orientation?: number; place?: boolean } = {},
): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      pixels[at] = (x * 255) / width;
      pixels[at + 1] = (y * 255) / height;
      pixels[at + 2] = 90;
    }
  }
  let image = sharp(pixels, { raw: { width, height, channels: 3 } });
  if (options.orientation || options.place) {
    image = image.withMetadata({
      ...(options.orientation ? { orientation: options.orientation } : {}),
      // Where the photograph was taken, as a phone writes it.
      ...(options.place ? { exif: { IFD3: { GPSLatitudeRef: "S", GPSLatitude: "0/1 3/1 0/1" } } } : {}),
    });
  }
  const format = options.format ?? "jpeg";
  return new Uint8Array(await image.toFormat(format).toBuffer());
}

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

const file = (bytes: Uint8Array, name = "photo.jpg") => new File([new Uint8Array(bytes)], name);

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

describe("checking a photograph before it goes up", () => {
  it("refuses what is not a photograph the site can use, in words that say why", async () => {
    await expect(preparePhoto(new Uint8Array(), "a")).rejects.toThrow("Choose a photograph to put up.");
    await expect(preparePhoto(new TextEncoder().encode("not a picture at all"), "a")).rejects.toThrow(
      "Choose a JPEG, PNG or WebP.",
    );
    await expect(preparePhoto(await photograph(800, 600), "a")).rejects.toThrow(
      "That photograph is 800 pixels wide. Choose one at least 1,200 wide",
    );
    await expect(preparePhoto(await photograph(1200, 1600), "a")).rejects.toThrow("too tall for its frame");
    await expect(preparePhoto(await photograph(2400, 1000), "a")).rejects.toThrow("too long and thin");
    expect(await saved()).toEqual([]);
  });

  it("saves four widths in three formats, with nothing in them but the picture", async () => {
    const prepared = await preparePhoto(await photograph(2000, 1500, { place: true }), "forest-cottage-main");

    expect(prepared).toMatchObject({ width: 1600, height: 1200, widths: [480, 800, 1200, 1600] });
    expect(prepared.file).toMatch(/^forest-cottage-main-[0-9a-f]{10}$/);
    expect(prepared.colour).toMatch(/^#[0-9a-f]{6}$/);
    const names = await saved();
    expect(names).toHaveLength(12);
    for (const width of [480, 800, 1200, 1600]) {
      for (const format of ["avif", "webp", "jpg"]) expect(names).toContain(`${prepared.file}-${width}.${format}`);
    }

    const largest = await readPhotoFile(`${prepared.file}-1600.jpg`);
    expect(largest?.type).toBe("image/jpeg");
    const meta = await sharp(largest!.body).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.exif).toBeUndefined();
  });

  it("turns a photograph the right way up when the phone was held on its side", async () => {
    // Saved 1500 wide and 2000 tall, with a note that it is to be turned a quarter.
    const prepared = await preparePhoto(await photograph(1500, 2000, { orientation: 6 }), "a");
    expect(prepared).toMatchObject({ width: 1600, height: 1200 });
    const copy = await readPhotoFile(`${prepared.file}-800.webp`);
    const meta = await sharp(copy!.body).metadata();
    expect([meta.width, meta.height]).toEqual([800, 600]);
  });

  it("never saves a copy wider than the photograph", async () => {
    const prepared = await preparePhoto(await photograph(1300, 975, { format: "png" }), "a");
    expect(prepared).toMatchObject({ width: 1300, height: 975, widths: [480, 800, 1200] });
    expect(await saved()).toHaveLength(9);
  });

  it("trims a photograph of another shape to the 4:3 frame the site shows it in", async () => {
    // 16:9, as many cameras take them: the sides go.
    const wide = await preparePhoto(await photograph(2400, 1350), "wide");
    expect(wide).toMatchObject({ width: 1600, height: 1200 });
    const copy = await sharp((await readPhotoFile(`${wide.file}-1200.jpg`))!.body).metadata();
    expect([copy.width, copy.height]).toEqual([1200, 900]);

    // 5:4: a strip goes from the top and the bottom.
    expect(await preparePhoto(await photograph(1500, 1200), "square")).toMatchObject({ width: 1500, height: 1125 });

    // Wide enough as it came, but not once trimmed.
    await expect(preparePhoto(await photograph(1500, 800), "a")).rejects.toThrow(
      "That photograph is 1,067 pixels wide once trimmed to the site's 4:3 frame.",
    );
  });

  it("serves only copies by their exact names", async () => {
    const prepared = await preparePhoto(await photograph(1600, 1200, { format: "webp" }), "a");
    expect((await readPhotoFile(`${prepared.file}-480.avif`))?.type).toBe("image/avif");
    expect(await readPhotoFile(`${prepared.file}-481.avif`)).toBeNull();
    expect(await readPhotoFile("../env")).toBeNull();
    expect(await readPhotoFile(`..%2F${prepared.file}-480.avif`)).toBeNull();
    expect(await readPhotoFile(`${prepared.file}-480.png`)).toBeNull();
  });
});

describe("preparing a photograph in a process of its own", () => {
  // The tool as the server runs it, here from its source.
  const tool = [process.execPath, "--import", "tsx", "src/tools/prepare-photo.ts"];

  it("brings back the copies, or the refusal in words", async () => {
    const made = await preparePhotoApart(await photograph(1600, 1200), "forest-cottage-inside", tool);
    expect(made).toMatchObject({ width: 1600, height: 1200, widths: [480, 800, 1200, 1600] });
    expect(await saved()).toHaveLength(12);

    await expect(preparePhotoApart(await photograph(800, 600), "a", tool)).rejects.toThrow("at least 1,200 wide");
    expect(await saved()).toHaveLength(12);
  }, 60_000);

  it("says so plainly, and leaves no half-made copies, when the work stops without an answer", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = path.join(folder, "photos");
    await mkdir(dir, { recursive: true });
    // As if the tool had been stopped part way through the third copy.
    for (const left of ["a-0123456789-480.avif", "a-0123456789-480.webp", "a-0123456789-480.jpg.part"]) {
      await writeFile(path.join(dir, left), "x");
    }
    await expect(
      preparePhotoApart(await photograph(1600, 1200), "a", [process.execPath, "-e", "process.exit(3)"]),
    ).rejects.toThrow("That photograph could not be prepared. Save a smaller copy of it and try again.");
    expect(await saved()).toEqual([]);
    quiet.mockRestore();
  });
});

describe("putting up the photographs of a room", () => {
  const described = "The cottage from the lawn, smoke rising from the chimney";

  it("shows a new photograph in its place on the site, and takes the one it replaced off the server", async () => {
    const lodge = await loadCatalogue();
    const cottage = roomTypeBySlug(lodge, "forest-cottage")!;
    expect(cottage.photos.main?.base).toBe("/photos/forest-cottage");

    const said = await change(
      "photo-add",
      { type: String(cottage.id), place: "main", description: described, photo: file(await photograph(2000, 1500)) },
      manager,
    );
    expect(said).toBe("The new main photograph of Forest Cottage is up on the site.");

    forgetCatalogue();
    const first = roomTypeBySlug(await loadCatalogue(), "forest-cottage")!.photos.main!;
    expect(first.base).toMatch(/^\/uploads\/forest-cottage-main-[0-9a-f]{10}$/);
    expect(first.description).toBe(described);
    expect(first.version).toBe("");
    // The other two places keep the photographs the site was built with.
    expect(roomTypeBySlug(await loadCatalogue(), "forest-cottage")!.photos.inside?.base).toBe(
      "/photos/forest-cottage-inside",
    );

    await change(
      "photo-add",
      { type: String(cottage.id), place: "main", description: described, photo: file(await photograph(1800, 1200)) },
      owner,
    );
    forgetCatalogue();
    const second = roomTypeBySlug(await loadCatalogue(), "forest-cottage")!.photos.main!;
    expect(second.base).not.toBe(first.base);
    const names = await saved();
    expect(names).toHaveLength(12);
    expect(names.every((name) => name.startsWith(second.base.slice("/uploads/".length)))).toBe(true);
  });

  it("changes a description, and puts back the original with nothing left behind", async () => {
    const cottage = roomTypeBySlug(await loadCatalogue(), "mountain-tent")!;
    const where = { type: String(cottage.id), place: "detail" };
    await change("photo-add", { ...where, description: described, photo: file(await photograph(2000, 1500)) }, owner);

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

  it("asks for a description and a photograph, and saves nothing without them", async () => {
    const cottage = roomTypeBySlug(await loadCatalogue(), "forest-cottage")!;
    const where = { type: String(cottage.id), place: "inside" };
    await expect(
      change("photo-add", { ...where, description: described, photo: file(new Uint8Array()) }, owner),
    ).rejects.toThrow("Choose a photograph to put up.");
    await expect(
      change("photo-add", { ...where, description: "Bed", photo: file(await photograph(2000, 1500)) }, owner),
    ).rejects.toBeInstanceOf(SetupError);
    await expect(
      change("photo-add", { ...where, description: described, photo: file(await photograph(900, 600)) }, owner),
    ).rejects.toThrow("at least 1,200 wide");
    await expect(
      change(
        "photo-add",
        { type: String(cottage.id), place: "roof", description: described, photo: file(await photograph(2000, 1500)) },
        owner,
      ),
    ).rejects.toThrow("Choose where the photograph goes.");
    expect(await saved()).toEqual([]);
    expect(await db().select().from(schema.roomPhotos)).toEqual([]);
  });

  it("is refused to the front desk and to training accounts, where the data is changed", async () => {
    const cottage = roomTypeBySlug(await loadCatalogue(), "forest-cottage")!;
    const values = {
      type: String(cottage.id),
      place: "main",
      description: described,
      photo: file(await photograph(2000, 1500)),
    };
    await expect(change("photo-add", values, desk)).rejects.toBeInstanceOf(NotAllowed);
    await expect(change("photo-add", values, trainee)).rejects.toThrow(/Training accounts/);
    await expect(change("photo-remove", { type: String(cottage.id), place: "main" }, trainee)).rejects.toBeInstanceOf(
      NotAllowed,
    );
    expect(await saved()).toEqual([]);
  });
});
