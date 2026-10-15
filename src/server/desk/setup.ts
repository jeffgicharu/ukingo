// How the lodge is set up, and every change staff can make to it: rooms,
// prices, seasons, rules, the words on the site, the lodge's own details.
//
// Each change is a small definition: who may make it, how to read it from the
// form, how to say what it would do, and how to do it. A change to prices or
// rules is said back to the member of staff before it is saved. Permission is
// checked here, where the data is changed, and not only on the screen.

import { and, asc, eq, sql } from "drizzle-orm";

import { type Day, addDays, isDay, lodgeDay } from "@/lib/dates";
import { formatDay, formatMoney, plural } from "@/lib/format";
import { db, schema, UNIQUE_VIOLATION, violates, type Queryable } from "@/server/db";
import { builtIn, builtInName, isPlace, photographOf, UPLOAD } from "@/photos/picture";
import type { CancellationStep, PhotoPlace } from "@/server/db/schema";
import { forgetCatalogue } from "@/server/lodge/catalogue";
import { forgetContent } from "@/server/lodge/content";
import { keepPhoto, PhotoError, removePhotoFiles, type Copy } from "@/server/lodge/photo-files";
import { must, type Ability, type Staff } from "@/server/staff/permissions";

/** Something wrong with what was typed, in words for the person who typed it. */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

type Fields = { text(name: string): string; has(name: string): boolean; file(name: string): File | null };

/** Reads a form the way these definitions want it: trimmed text, a test for ticked boxes, and a chosen file. */
export function fieldsOf(form: FormData): Fields {
  return {
    text: (name) => {
      const value = form.get(name);
      return typeof value === "string" ? value.trim() : "";
    },
    has: (name) => form.get(name) !== null,
    file: (name) => {
      const value = form.get(name);
      // A form sent with no file chosen still carries an empty one.
      return value instanceof File && value.size > 0 ? value : null;
    },
  };
}

function whole(fields: Fields, name: string, label: string, range: { min: number; max: number }): number {
  const typed = fields.text(name).replace(/,/g, "");
  if (!/^\d+$/.test(typed)) throw new SetupError(`${label}: enter a whole number.`);
  const value = Number(typed);
  if (value < range.min || value > range.max) {
    throw new SetupError(`${label}: enter a number from ${range.min} to ${range.max}.`);
  }
  return value;
}

/** An amount typed in shillings, kept in cents. */
function shillings(fields: Fields, name: string, label: string, range = { min: 0, max: 2_000_000 }): number {
  return whole(fields, name, label, range) * 100;
}

function words(fields: Fields, name: string, label: string, range: { min?: number; max: number }): string {
  const value = fields.text(name).replace(/\r\n/g, "\n");
  if (value.length < (range.min ?? 0)) throw new SetupError(`${label} is needed.`);
  if (value.length > range.max) throw new SetupError(`${label} is too long. Keep it under ${range.max} characters.`);
  return value;
}

function day(fields: Fields, name: string, label: string): Day {
  const value = fields.text(name);
  if (!isDay(value)) throw new SetupError(`${label}: choose a date.`);
  return value;
}

const nights = (from: Day, to: Day) => `${formatDay(from, "compact")} to ${formatDay(addDays(to, -1))}`;

export type SetupAction<P> = {
  ability: Ability;
  /** A change to prices or rules is shown back before it is saved. */
  review?: { affects: string };
  read(fields: Fields): P | Promise<P>;
  /** What the change would do, a line for each thing that would differ. Empty when nothing would. */
  lines?(proposal: P): Promise<string[]>;
  /** Makes the change, and says in a sentence what was done. */
  apply(proposal: P, staff: Staff, now: Date): Promise<string>;
};

const define = <P>(action: SetupAction<P>) => action;

const NEW_BOOKINGS =
  "This applies to bookings made from now on. Every booking already made keeps the prices and terms it was made with.";

// ── Prices ────────────────────────────────────────────────────────────────

type RateRow = [roomTypeId: number, seasonId: number, weeknightCents: number, weekendCents: number];

const prices = define<{ rates: RateRow[] }>({
  ability: "rates.edit",
  review: { affects: NEW_BOOKINGS },
  async read(fields) {
    const types = await db().select().from(schema.roomTypes).where(eq(schema.roomTypes.active, true));
    const seasons = await db().select().from(schema.seasons);
    const rates: RateRow[] = [];
    for (const type of types) {
      for (const season of seasons) {
        const label = `${type.name}, ${season.name.toLowerCase()}`;
        const range = { min: 500, max: 2_000_000 };
        rates.push([
          type.id,
          season.id,
          shillings(fields, `w-${type.id}-${season.id}`, `${label}, Sunday to Thursday nights`, range),
          shillings(fields, `e-${type.id}-${season.id}`, `${label}, Friday and Saturday nights`, range),
        ]);
      }
    }
    return { rates };
  },
  async lines({ rates }) {
    const types = new Map((await db().select().from(schema.roomTypes)).map((type) => [type.id, type.name]));
    const seasons = new Map((await db().select().from(schema.seasons)).map((season) => [season.id, season.name]));
    const current = await db().select().from(schema.rates);
    const lines: string[] = [];
    for (const [typeId, seasonId, weeknight, weekend] of rates) {
      const now = current.find((rate) => rate.roomTypeId === typeId && rate.seasonId === seasonId);
      const what = `${types.get(typeId)}, ${seasons.get(seasonId)?.toLowerCase()}`;
      const was = (cents: number | undefined) => (cents === undefined ? "no price" : formatMoney(cents));
      if (now?.weeknightCents !== weeknight) {
        lines.push(
          `${what}, Sunday to Thursday nights: ${was(now?.weeknightCents)} becomes ${formatMoney(weeknight)}.`,
        );
      }
      if (now?.weekendCents !== weekend) {
        lines.push(`${what}, Friday and Saturday nights: ${was(now?.weekendCents)} becomes ${formatMoney(weekend)}.`);
      }
    }
    return lines;
  },
  async apply({ rates }, staff) {
    must(staff, "rates.edit");
    await db().transaction(async (tx) => {
      for (const [roomTypeId, seasonId, weeknightCents, weekendCents] of rates) {
        await tx
          .insert(schema.rates)
          .values({ roomTypeId, seasonId, weeknightCents, weekendCents })
          .onConflictDoUpdate({
            target: [schema.rates.roomTypeId, schema.rates.seasonId],
            set: { weeknightCents, weekendCents },
          });
      }
    });
    forgetCatalogue();
    return "The new prices are in use.";
  },
});

// ── Seasons and shortest stays ────────────────────────────────────────────

type Overlap = { id: number; seasonId: number; name: string; label: string; from: Day; to: Day };

/** The dates already given to a season that share any night with these. */
async function seasonDatesOver(q: Queryable, from: Day, to: Day): Promise<Overlap[]> {
  const found = await q.execute<{ id: number; season_id: number; name: string; label: string; from: Day; to: Day }>(sql`
    SELECT d.id, d.season_id, s.name, d.label, lower(d.dates)::text AS "from", upper(d.dates)::text AS "to"
    FROM season_dates d JOIN seasons s ON s.id = d.season_id
    WHERE d.dates && daterange(${from}::date, ${to}::date)
    ORDER BY lower(d.dates)
  `);
  return found.rows.map((row) => ({
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    label: row.label,
    from: row.from,
    to: row.to,
  }));
}

/** What is left of some dates once other nights are cut out of them: a piece before, a piece after, or neither. */
function leftOf(dates: { from: Day; to: Day }, cut: { from: Day; to: Day }): { from: Day; to: Day }[] {
  return [
    { from: dates.from, to: cut.from },
    { from: cut.to, to: dates.to },
  ].filter((piece) => piece.from < piece.to);
}

const seasonAdd = define<{ seasonId: number; label: string; from: Day; to: Day }>({
  ability: "rates.edit",
  review: { affects: NEW_BOOKINGS },
  async read(fields) {
    const seasonId = whole(fields, "season", "Season", { min: 1, max: 1_000_000 });
    const from = day(fields, "from", "First night");
    const last = day(fields, "last", "Last night");
    if (last < from) throw new SetupError("The last night must not be before the first.");
    const to = addDays(last, 1);
    const [season] = await db().select().from(schema.seasons).where(eq(schema.seasons.id, seasonId));
    if (!season) throw new SetupError("Choose a season.");
    if (season.isDefault) {
      throw new SetupError(`${season.name} is the season of every night not given to another. It needs no dates.`);
    }
    const already = (await seasonDatesOver(db(), from, to)).find(
      (dates) => dates.seasonId === seasonId && dates.from <= from && dates.to >= to,
    );
    if (already) {
      throw new SetupError(
        `Those nights are already ${season.name.toLowerCase()}${already.label ? ` (${already.label})` : ""}.`,
      );
    }
    return { seasonId, label: words(fields, "label", "A name for these dates", { min: 2, max: 60 }), from, to };
  },
  async lines({ seasonId, label, from, to }) {
    const [season] = await db().select().from(schema.seasons).where(eq(schema.seasons.id, seasonId));
    const lines = [
      `${season?.name ?? "That season"} prices will apply to the nights of ${nights(from, to)} (${label}).`,
    ];
    // A night belongs to one season, so the new dates are cut out of whatever had those nights.
    for (const taken of await seasonDatesOver(db(), from, to)) {
      const left = leftOf(taken, { from, to });
      const what = `${taken.name}${taken.label ? ` (${taken.label})` : ""}`;
      lines.push(
        left.length
          ? `${what} gives up those nights, and keeps ${left.map((piece) => nights(piece.from, piece.to)).join(" and ")}.`
          : `${what} gives up all its nights, ${nights(taken.from, taken.to)}.`,
      );
    }
    return lines;
  },
  async apply({ seasonId, label, from, to }, staff) {
    must(staff, "rates.edit");
    await db().transaction(async (tx) => {
      for (const taken of await seasonDatesOver(tx, from, to)) {
        await tx.delete(schema.seasonDates).where(eq(schema.seasonDates.id, taken.id));
        for (const piece of leftOf(taken, { from, to })) {
          await tx.insert(schema.seasonDates).values({ seasonId: taken.seasonId, label: taken.label, dates: piece });
        }
      }
      await tx.insert(schema.seasonDates).values({ seasonId, label, dates: { from, to } });
    });
    forgetCatalogue();
    return "Those nights now have that season's prices.";
  },
});

const seasonRemove = define<{ id: number }>({
  ability: "rates.edit",
  review: { affects: NEW_BOOKINGS },
  read: (fields) => ({ id: whole(fields, "id", "The dates", { min: 1, max: 1_000_000_000 }) }),
  async lines({ id }) {
    const found = await db().execute<{ name: string; label: string; from: Day; to: Day; fallback: string | null }>(sql`
      SELECT s.name, d.label, lower(d.dates)::text AS "from", upper(d.dates)::text AS "to",
        (SELECT name FROM seasons WHERE is_default LIMIT 1) AS fallback
      FROM season_dates d JOIN seasons s ON s.id = d.season_id WHERE d.id = ${id}
    `);
    const row = found.rows[0];
    if (!row) return [];
    return [
      `${row.name} prices will no longer apply to the nights of ${nights(row.from, row.to)}${row.label ? ` (${row.label})` : ""}. Those nights go back to ${(row.fallback ?? "the usual").toLowerCase()} prices.`,
    ];
  },
  async apply({ id }, staff) {
    must(staff, "rates.edit");
    await db().delete(schema.seasonDates).where(eq(schema.seasonDates.id, id));
    forgetCatalogue();
    return "Those dates are removed.";
  },
});

const stayAdd = define<{ label: string; from: Day; to: Day; minNights: number }>({
  ability: "rates.edit",
  review: { affects: NEW_BOOKINGS },
  read(fields) {
    const from = day(fields, "from", "First night");
    const last = day(fields, "last", "Last night");
    if (last < from) throw new SetupError("The last night must not be before the first.");
    return {
      label: words(fields, "label", "A name for these dates", { min: 2, max: 60 }),
      from,
      to: addDays(last, 1),
      minNights: whole(fields, "min", "Shortest stay", { min: 2, max: 14 }),
    };
  },
  lines: async ({ label, from, to, minNights }) => [
    `A stay that includes any night of ${nights(from, to)} (${label}) must be at least ${plural(minNights, "night")}.`,
  ],
  async apply({ label, from, to, minNights }, staff) {
    must(staff, "rates.edit");
    await db().insert(schema.stayRules).values({ label, dates: { from, to }, minNights });
    forgetCatalogue();
    return "The shortest stay for those dates is set.";
  },
});

const stayRemove = define<{ id: number }>({
  ability: "rates.edit",
  review: { affects: NEW_BOOKINGS },
  read: (fields) => ({ id: whole(fields, "id", "The rule", { min: 1, max: 1_000_000_000 }) }),
  async lines({ id }) {
    const [rule] = await db().select().from(schema.stayRules).where(eq(schema.stayRules.id, id));
    return rule
      ? [`Stays over ${rule.label} (${nights(rule.dates.from, rule.dates.to)}) may again be a single night.`]
      : [];
  },
  async apply({ id }, staff) {
    must(staff, "rates.edit");
    await db().delete(schema.stayRules).where(eq(schema.stayRules.id, id));
    forgetCatalogue();
    return "That rule is removed.";
  },
});

// ── Meals and extras ──────────────────────────────────────────────────────

type PlanRow = { code: string; name: string; description: string; adultCents: number; childCents: number };

const meals = define<{ plans: PlanRow[] }>({
  ability: "rates.edit",
  review: { affects: NEW_BOOKINGS },
  async read(fields) {
    const current = await db().select().from(schema.mealPlans).orderBy(asc(schema.mealPlans.position));
    return {
      plans: current.map((plan) => ({
        code: plan.code,
        name: words(fields, `name-${plan.code}`, "The name of a meal plan", { min: 2, max: 40 }),
        description: words(fields, `description-${plan.code}`, `${plan.name}: what is included`, { max: 200 }),
        adultCents: shillings(fields, `adult-${plan.code}`, `${plan.name}, each adult`, { min: 0, max: 100_000 }),
        childCents: shillings(fields, `child-${plan.code}`, `${plan.name}, each child`, { min: 0, max: 100_000 }),
      })),
    };
  },
  async lines({ plans }) {
    const current = await db().select().from(schema.mealPlans);
    const lines: string[] = [];
    for (const plan of plans) {
      const now = current.find((row) => row.code === plan.code);
      if (!now) continue;
      if (now.name !== plan.name) lines.push(`${now.name} will be called ${plan.name}.`);
      if (now.description !== plan.description) lines.push(`${plan.name}: the description changes.`);
      if (now.adultCents !== plan.adultCents) {
        lines.push(
          `${plan.name}, each adult a night: ${formatMoney(now.adultCents)} becomes ${formatMoney(plan.adultCents)}.`,
        );
      }
      if (now.childCents !== plan.childCents) {
        lines.push(
          `${plan.name}, each child a night: ${formatMoney(now.childCents)} becomes ${formatMoney(plan.childCents)}.`,
        );
      }
    }
    return lines;
  },
  async apply({ plans }, staff) {
    must(staff, "rates.edit");
    await db().transaction(async (tx) => {
      for (const { code, ...values } of plans) {
        await tx.update(schema.mealPlans).set(values).where(eq(schema.mealPlans.code, code));
      }
    });
    forgetCatalogue();
    return "The meal plans are saved.";
  },
});

type ExtraRow = {
  id: number | null;
  name: string;
  duration: string;
  priceCents: number;
  charged: "per_person" | "per_booking";
  active: boolean;
};

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

const extras = define<{ extras: ExtraRow[] }>({
  ability: "rates.edit",
  review: { affects: NEW_BOOKINGS },
  async read(fields) {
    const current = await db().select().from(schema.extras).orderBy(asc(schema.extras.position));
    const charged = (name: string) => (fields.text(name) === "per_booking" ? "per_booking" : "per_person");
    const rows: ExtraRow[] = current.map((extra) => ({
      id: extra.id,
      name: words(fields, `name-${extra.id}`, "The name of an extra", { min: 2, max: 60 }),
      duration: words(fields, `duration-${extra.id}`, `${extra.name}: how long it takes`, { max: 40 }),
      priceCents: shillings(fields, `price-${extra.id}`, `${extra.name}, price`, { min: 0, max: 500_000 }),
      charged: charged(`charged-${extra.id}`),
      active: fields.has(`active-${extra.id}`),
    }));
    if (fields.text("name-new")) {
      rows.push({
        id: null,
        name: words(fields, "name-new", "The name of the new extra", { min: 2, max: 60 }),
        duration: words(fields, "duration-new", "The new extra: how long it takes", { max: 40 }),
        priceCents: shillings(fields, "price-new", "The new extra, price", { min: 0, max: 500_000 }),
        charged: charged("charged-new"),
        active: true,
      });
    }
    return { extras: rows };
  },
  async lines({ extras: rows }) {
    const current = await db().select().from(schema.extras);
    const each = (charged: string) => (charged === "per_person" ? "each guest" : "each booking");
    const lines: string[] = [];
    for (const row of rows) {
      const now = current.find((extra) => extra.id === row.id);
      if (!now) {
        lines.push(`A new extra: ${row.name}, ${formatMoney(row.priceCents)} ${each(row.charged)}.`);
        continue;
      }
      if (now.name !== row.name) lines.push(`${now.name} will be called ${row.name}.`);
      if (now.duration !== row.duration) lines.push(`${row.name}: “${now.duration}” becomes “${row.duration}”.`);
      if (now.priceCents !== row.priceCents || now.charged !== row.charged) {
        lines.push(
          `${row.name}: ${formatMoney(now.priceCents)} ${each(now.charged)} becomes ${formatMoney(row.priceCents)} ${each(row.charged)}.`,
        );
      }
      if (now.active !== row.active) {
        lines.push(row.active ? `${row.name} is offered again.` : `${row.name} is no longer offered to guests.`);
      }
    }
    return lines;
  },
  async apply({ extras: rows }, staff) {
    must(staff, "rates.edit");
    try {
      await db().transaction(async (tx) => {
        for (const { id, ...values } of rows) {
          if (id !== null) {
            await tx.update(schema.extras).set(values).where(eq(schema.extras.id, id));
          } else {
            const [{ next }] = await tx
              .select({ next: sql<number>`coalesce(max(${schema.extras.position}), 0) + 1` })
              .from(schema.extras);
            await tx.insert(schema.extras).values({ ...values, slug: slugOf(values.name), position: next });
          }
        }
      });
    } catch (error) {
      if (violates(error, UNIQUE_VIOLATION)) throw new SetupError("There is already an extra with that name.");
      throw error;
    }
    forgetCatalogue();
    return "The extras are saved.";
  },
});

// ── Kinds of room, and the rooms themselves ───────────────────────────────

const roomType = define<{
  id: number;
  name: string;
  tagline: string;
  description: string;
  sleeps: number;
  bedrooms: number;
  beds: string;
  sizeSqm: number | null;
  features: string[];
}>({
  ability: "rates.edit",
  read: (fields) => ({
    id: whole(fields, "id", "The kind of room", { min: 1, max: 1_000_000 }),
    name: words(fields, "name", "Name", { min: 2, max: 60 }),
    tagline: words(fields, "tagline", "The line under the name", { max: 120 }),
    description: words(fields, "description", "Description", { max: 2000 }),
    sleeps: whole(fields, "sleeps", "Sleeps", { min: 1, max: 20 }),
    bedrooms: whole(fields, "bedrooms", "Bedrooms", { min: 1, max: 10 }),
    beds: words(fields, "beds", "Beds", { max: 80 }),
    sizeSqm: fields.text("size") ? whole(fields, "size", "Size", { min: 5, max: 2000 }) : null,
    features: fields
      .text("features")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20),
  }),
  async apply({ id, ...values }, staff) {
    must(staff, "rates.edit");
    try {
      await db().update(schema.roomTypes).set(values).where(eq(schema.roomTypes.id, id));
    } catch (error) {
      if (violates(error, UNIQUE_VIOLATION)) throw new SetupError("Another kind of room has that name.");
      throw error;
    }
    forgetCatalogue();
    return `${values.name} is saved.`;
  },
});

const roomAdd = define<{ roomTypeId: number; name: string }>({
  ability: "rates.edit",
  read: (fields) => ({
    roomTypeId: whole(fields, "type", "The kind of room", { min: 1, max: 1_000_000 }),
    name: words(fields, "name", "The room's name", { min: 2, max: 40 }),
  }),
  async apply({ roomTypeId, name }, staff) {
    must(staff, "rates.edit");
    try {
      const [{ next }] = await db()
        .select({ next: sql<number>`coalesce(max(${schema.rooms.position}), 0) + 1` })
        .from(schema.rooms);
      await db().insert(schema.rooms).values({ roomTypeId, name, position: next });
    } catch (error) {
      if (violates(error, UNIQUE_VIOLATION)) throw new SetupError(`There is already a room called ${name}.`);
      throw error;
    }
    forgetCatalogue();
    return `${name} is added and can be booked.`;
  },
});

const roomChange = define<{ id: number; name: string; active: boolean }>({
  ability: "rates.edit",
  read: (fields) => ({
    id: whole(fields, "id", "The room", { min: 1, max: 1_000_000 }),
    name: words(fields, "name", "The room's name", { min: 2, max: 40 }),
    active: fields.text("use") !== "out",
  }),
  async apply({ id, name, active }, staff, now) {
    must(staff, "rates.edit");
    const [room] = await db().select().from(schema.rooms).where(eq(schema.rooms.id, id));
    if (!room) throw new SetupError("That room could not be found.");
    if (room.active && !active) {
      // A room with guests still to come cannot quietly vanish from under them.
      const ahead = await db().execute(sql`
        SELECT 1 FROM allocations a
        WHERE a.room_id = ${id} AND upper(a.stay) > ${lodgeDay(now)}::date
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.id = a.booking_id AND b.status IN ('held', 'provisional') AND b.hold_until <= ${now}
          )
        LIMIT 1
      `);
      if (ahead.rows.length) {
        throw new SetupError(
          `${room.name} has stays or blocks still to come. Move them to another room on the calendar first.`,
        );
      }
    }
    try {
      await db().update(schema.rooms).set({ name, active }).where(eq(schema.rooms.id, id));
    } catch (error) {
      if (violates(error, UNIQUE_VIOLATION)) throw new SetupError(`There is already a room called ${name}.`);
      throw error;
    }
    forgetCatalogue();
    return !active && room.active
      ? `${name} is out of use. Its past stays are kept.`
      : active && !room.active
        ? `${name} is back in use.`
        : `${name} is saved.`;
  },
});

// ── Photographs of the rooms ──────────────────────────────────────────────

async function kindOfRoom(fields: Fields): Promise<{ id: number; slug: string; name: string }> {
  const id = whole(fields, "type", "The kind of room", { min: 1, max: 1_000_000 });
  const [type] = await db()
    .select({ id: schema.roomTypes.id, slug: schema.roomTypes.slug, name: schema.roomTypes.name })
    .from(schema.roomTypes)
    .where(eq(schema.roomTypes.id, id));
  if (!type) throw new SetupError("Choose a kind of room.");
  return type;
}

function placeOf(fields: Fields): PhotoPlace {
  const place = fields.text("place");
  if (!isPlace(place)) throw new SetupError("Choose where the photograph goes.");
  return place;
}

const describing = (fields: Fields) => words(fields, "description", "What the photograph shows", { min: 10, max: 200 });

const photoAdd = define<{
  type: { id: number; slug: string; name: string };
  place: PhotoPlace;
  description: string;
  colour: string;
  copies: Copy[];
}>({
  ability: "rates.edit",
  async read(fields) {
    const type = await kindOfRoom(fields);
    const place = placeOf(fields);
    // The copies the browser made, one field each: jpg-480, webp-480, jpg-800 ...
    const copies: Copy[] = [];
    for (const width of UPLOAD.widths) {
      for (const format of ["jpg", "webp"] as const) {
        const copy = fields.file(`${format}-${width}`);
        if (copy) copies.push({ format, width, bytes: new Uint8Array(await copy.arrayBuffer()) });
      }
    }
    if (copies.length === 0) {
      throw new SetupError(
        fields.file("photo")
          ? "Putting up a photograph needs scripts switched on in this browser: the photograph is made ready in the browser before it is sent."
          : "Choose a photograph to put up.",
      );
    }
    const colour = fields.text("colour").toLowerCase();
    return {
      type,
      place,
      description: describing(fields),
      // Shown while the photograph loads. A plain dark green if the browser did not say.
      colour: /^#[0-9a-f]{6}$/.test(colour) ? colour : "#3a433f",
      copies,
    };
  },
  async apply({ type, place, description, colour, copies }, staff) {
    must(staff, "rates.edit");
    let prepared;
    try {
      prepared = await keepPhoto(`${type.slug}-${place}`, copies);
    } catch (error) {
      if (error instanceof PhotoError) throw new SetupError(error.message);
      throw error;
    }

    let before: string | undefined;
    try {
      before = await db().transaction(async (tx) => {
        const [old] = await tx
          .select({ file: schema.roomPhotos.file })
          .from(schema.roomPhotos)
          .where(and(eq(schema.roomPhotos.roomTypeId, type.id), eq(schema.roomPhotos.place, place)))
          .for("update");
        const values = { ...prepared, colour, description, addedBy: staff.id, addedAt: new Date() };
        await tx
          .insert(schema.roomPhotos)
          .values({ roomTypeId: type.id, place, ...values })
          .onConflictDoUpdate({ target: [schema.roomPhotos.roomTypeId, schema.roomPhotos.place], set: values });
        return old?.file;
      });
    } catch (error) {
      await removePhotoFiles(prepared.file);
      throw error;
    }
    // The photograph it replaced is no longer shown anywhere.
    if (before) await removePhotoFiles(before);
    forgetCatalogue();
    return `The new ${place} photograph of ${type.name} is up on the site.`;
  },
});

const photoDescribe = define<{ type: { id: number; name: string }; place: PhotoPlace; description: string }>({
  ability: "rates.edit",
  read: async (fields) => ({ type: await kindOfRoom(fields), place: placeOf(fields), description: describing(fields) }),
  async apply({ type, place, description }, staff) {
    must(staff, "rates.edit");
    const changed = await db()
      .update(schema.roomPhotos)
      .set({ description })
      .where(and(eq(schema.roomPhotos.roomTypeId, type.id), eq(schema.roomPhotos.place, place)))
      .returning({ file: schema.roomPhotos.file });
    if (changed.length === 0) throw new SetupError("That photograph has been taken down. Nothing was changed.");
    forgetCatalogue();
    return `The description of ${photographOf(place, type.name)} is saved.`;
  },
});

const photoRemove = define<{ type: { id: number; slug: string; name: string }; place: PhotoPlace }>({
  ability: "rates.edit",
  read: async (fields) => ({ type: await kindOfRoom(fields), place: placeOf(fields) }),
  async apply({ type, place }, staff) {
    must(staff, "rates.edit");
    const [removed] = await db()
      .delete(schema.roomPhotos)
      .where(and(eq(schema.roomPhotos.roomTypeId, type.id), eq(schema.roomPhotos.place, place)))
      .returning({ file: schema.roomPhotos.file });
    if (!removed) return "Nothing was changed.";
    await removePhotoFiles(removed.file);
    forgetCatalogue();
    return builtIn(builtInName(type.slug, place))
      ? `The ${place} photograph of ${type.name} is back to the one the site was built with.`
      : `The ${place} photograph of ${type.name} is taken down.`;
  },
});

// ── Booking rules ─────────────────────────────────────────────────────────

type Rules = {
  holdMinutes: number;
  provisionalHours: number;
  depositPercent: number;
  balanceDueDays: number;
  changeUntilDays: number;
  freeUntilDays: number;
  partKeepPercent: number;
  partUntilDays: number;
  bookingWindowMonths: number;
  sameDayUntilHour: number;
  maxNights: number;
};

/** The cancellation steps as the form shows them: free until, part kept until, then all kept. */
export function rulesOf(settings: typeof schema.settings.$inferSelect): Rules {
  const steps = [...settings.cancellationSteps].sort((a, b) => b.min_days - a.min_days);
  const free = steps.find((step) => step.keep_percent === 0);
  const part = steps.find((step) => step.keep_percent > 0 && step.keep_percent < 100);
  return {
    holdMinutes: settings.holdMinutes,
    provisionalHours: settings.provisionalHours,
    depositPercent: settings.depositPercent,
    balanceDueDays: settings.balanceDueDays,
    changeUntilDays: settings.changeUntilDays,
    freeUntilDays: free?.min_days ?? 0,
    partKeepPercent: part?.keep_percent ?? 100,
    partUntilDays: part?.min_days ?? 0,
    bookingWindowMonths: settings.bookingWindowMonths,
    sameDayUntilHour: settings.sameDayUntilHour,
    maxNights: settings.maxNights,
  };
}

function stepsOf(rules: Rules): CancellationStep[] {
  const steps: CancellationStep[] = [];
  if (rules.freeUntilDays > 0) steps.push({ min_days: rules.freeUntilDays, keep_percent: 0 });
  if (rules.partUntilDays > 0 && rules.partKeepPercent < 100) {
    steps.push({ min_days: rules.partUntilDays, keep_percent: rules.partKeepPercent });
  }
  steps.push({ min_days: 0, keep_percent: 100 });
  return steps;
}

const RULE_NAMES: Record<keyof Rules, [label: string, unit: (value: number) => string]> = {
  holdMinutes: ["A room is held while a guest pays for", (v) => plural(v, "minute")],
  provisionalHours: ["A booking made by staff waits for its deposit for", (v) => plural(v, "hour")],
  depositPercent: ["The deposit", (v) => `${v}% of the total`],
  balanceDueDays: ["The balance is due", (v) => `${plural(v, "day")} before arrival`],
  changeUntilDays: ["Guests can change their own dates until", (v) => `${plural(v, "day")} before arrival`],
  freeUntilDays: ["Cancelling is free until", (v) => `${plural(v, "day")} before arrival`],
  partKeepPercent: ["After that the lodge keeps", (v) => `${v}% of the total`],
  partUntilDays: ["That lasts until", (v) => `${plural(v, "day")} before arrival, and then there is no refund`],
  bookingWindowMonths: ["Bookings open", (v) => `${plural(v, "month")} ahead`],
  sameDayUntilHour: ["Tonight can be booked online until", (v) => `${v}:00`],
  maxNights: ["The longest stay online", (v) => plural(v, "night")],
};

const rules = define<Rules>({
  ability: "rules.edit",
  review: { affects: NEW_BOOKINGS },
  read(fields) {
    const read: Rules = {
      holdMinutes: whole(fields, "holdMinutes", "Minutes a room is held", { min: 5, max: 60 }),
      provisionalHours: whole(fields, "provisionalHours", "Hours a staff booking waits", { min: 1, max: 168 }),
      depositPercent: whole(fields, "depositPercent", "Deposit", { min: 10, max: 100 }),
      balanceDueDays: whole(fields, "balanceDueDays", "Days before arrival the balance is due", { min: 0, max: 90 }),
      changeUntilDays: whole(fields, "changeUntilDays", "Days before arrival dates can change", { min: 0, max: 90 }),
      freeUntilDays: whole(fields, "freeUntilDays", "Days before arrival cancelling is free", { min: 0, max: 180 }),
      partKeepPercent: whole(fields, "partKeepPercent", "Share kept after that", { min: 1, max: 100 }),
      partUntilDays: whole(fields, "partUntilDays", "Days before arrival that share applies until", {
        min: 0,
        max: 180,
      }),
      bookingWindowMonths: whole(fields, "bookingWindowMonths", "Months ahead", { min: 1, max: 24 }),
      sameDayUntilHour: whole(fields, "sameDayUntilHour", "Hour tonight closes online", { min: 0, max: 23 }),
      maxNights: whole(fields, "maxNights", "Longest stay", { min: 1, max: 60 }),
    };
    if (read.freeUntilDays > 0 && read.partUntilDays >= read.freeUntilDays) {
      throw new SetupError(
        "The part refund comes after free cancelling ends, so its number of days must be smaller than the first.",
      );
    }
    return read;
  },
  async lines(proposal) {
    const [settings] = await db().select().from(schema.settings);
    const current = rulesOf(settings);
    return (Object.keys(RULE_NAMES) as (keyof Rules)[])
      .filter((key) => current[key] !== proposal[key])
      .map((key) => {
        const [label, unit] = RULE_NAMES[key];
        return `${label}: ${unit(current[key])} becomes ${unit(proposal[key])}.`;
      });
  },
  async apply(proposal, staff, now) {
    must(staff, "rules.edit");
    const { freeUntilDays: _free, partKeepPercent: _keep, partUntilDays: _until, ...plain } = proposal;
    await db()
      .update(schema.settings)
      .set({ ...plain, cancellationSteps: stepsOf(proposal), updatedAt: now });
    forgetCatalogue();
    return "The new rules are in use for bookings made from now on.";
  },
});

// ── The lodge's own details ───────────────────────────────────────────────

const lodge = define<{ lodgeName: string; place: string; checkInFrom: string; checkOutBy: string }>({
  ability: "settings.edit",
  read: (fields) => ({
    lodgeName: words(fields, "lodgeName", "The lodge's name", { min: 2, max: 60 }),
    place: words(fields, "place", "Where it is", { min: 2, max: 80 }),
    checkInFrom: words(fields, "checkInFrom", "Check-in time", { min: 2, max: 20 }),
    checkOutBy: words(fields, "checkOutBy", "Check-out time", { min: 2, max: 20 }),
  }),
  async apply(values, staff, now) {
    must(staff, "settings.edit");
    await db()
      .update(schema.settings)
      .set({ ...values, updatedAt: now });
    forgetCatalogue();
    return "The lodge's details are saved.";
  },
});

// ── The words on the site ─────────────────────────────────────────────────

const wordsDraft = define<{ texts: [key: string, value: string][] }>({
  ability: "content.edit",
  async read(fields) {
    const rows = await db().select().from(schema.siteText);
    return {
      texts: rows.map((row) => [row.key, words(fields, `text-${row.key}`, row.label, { min: 1, max: 1200 })]),
    };
  },
  async apply({ texts }, staff, now) {
    must(staff, "content.edit");
    const rows = await db().select().from(schema.siteText);
    let waiting = 0;
    await db().transaction(async (tx) => {
      for (const [key, value] of texts) {
        const published = rows.find((row) => row.key === key)?.value;
        // Words the same as the published ones are not a draft.
        const draft = value === published ? null : value;
        if (draft !== null) waiting++;
        await tx.update(schema.siteText).set({ draft, updatedAt: now }).where(eq(schema.siteText.key, key));
      }
    });
    return waiting
      ? `Saved as a draft: ${plural(waiting, "piece")} of text ${waiting === 1 ? "differs" : "differ"} from what guests see. Preview the home page, then publish.`
      : "Nothing differs from what guests see now.";
  },
});

const wordsPublish = define<Record<string, never>>({
  ability: "content.edit",
  read: () => ({}),
  async apply(_nothing, staff, now) {
    must(staff, "content.edit");
    const published = await db()
      .update(schema.siteText)
      .set({ value: sql`${schema.siteText.draft}`, draft: null, updatedAt: now })
      .where(sql`${schema.siteText.draft} IS NOT NULL`)
      .returning({ key: schema.siteText.key });
    forgetContent();
    return published.length ? "Published. Guests now see the new words." : "There was nothing waiting to be published.";
  },
});

const wordsDiscard = define<Record<string, never>>({
  ability: "content.edit",
  read: () => ({}),
  async apply(_nothing, staff) {
    must(staff, "content.edit");
    await db().update(schema.siteText).set({ draft: null });
    return "The draft is thrown away. The published words are unchanged.";
  },
});

const pageDraft = define<{ slug: string; title: string; summary: string; body: string }>({
  ability: "content.edit",
  read: (fields) => ({
    slug: fields.text("slug"),
    title: words(fields, "title", "Title", { min: 2, max: 80 }),
    summary: words(fields, "summary", "The line under the title", { max: 300 }),
    body: words(fields, "body", "The page", { min: 10, max: 20_000 }),
  }),
  async apply({ slug, title, summary, body }, staff, now) {
    must(staff, "content.edit");
    const [current] = await db().select().from(schema.pages).where(eq(schema.pages.slug, slug));
    if (!current) throw new SetupError("That page could not be found.");
    const same = current.title === title && current.summary === summary && current.body === body;
    await db()
      .update(schema.pages)
      .set({
        draftTitle: same ? null : title,
        draftSummary: same ? null : summary,
        draftBody: same ? null : body,
        updatedAt: now,
        updatedBy: staff.id,
      })
      .where(eq(schema.pages.slug, slug));
    return same ? "Nothing differs from what guests see now." : "Saved as a draft. Preview the page, then publish it.";
  },
});

const pagePublish = define<{ slug: string }>({
  ability: "content.edit",
  read: (fields) => ({ slug: fields.text("slug") }),
  async apply({ slug }, staff, now) {
    must(staff, "content.edit");
    const published = await db()
      .update(schema.pages)
      .set({
        title: sql`coalesce(${schema.pages.draftTitle}, ${schema.pages.title})`,
        summary: sql`coalesce(${schema.pages.draftSummary}, ${schema.pages.summary})`,
        body: sql`coalesce(${schema.pages.draftBody}, ${schema.pages.body})`,
        draftTitle: null,
        draftSummary: null,
        draftBody: null,
        updatedAt: now,
        updatedBy: staff.id,
      })
      .where(and(eq(schema.pages.slug, slug), sql`${schema.pages.draftBody} IS NOT NULL`))
      .returning({ title: schema.pages.title });
    return published.length
      ? `Published. Guests now see the new “${published[0].title}”.`
      : "There was no draft of that page to publish.";
  },
});

const pageDiscard = define<{ slug: string }>({
  ability: "content.edit",
  read: (fields) => ({ slug: fields.text("slug") }),
  async apply({ slug }, staff) {
    must(staff, "content.edit");
    await db()
      .update(schema.pages)
      .set({ draftTitle: null, draftSummary: null, draftBody: null })
      .where(eq(schema.pages.slug, slug));
    return "The draft is thrown away. The published page is unchanged.";
  },
});

type QuestionRow = { id: number | null; topic: string; question: string; answer: string; shown: boolean };

const readQuestion = (fields: Fields, id: number | null): QuestionRow => ({
  id,
  topic: words(fields, "topic", "Topic", { min: 2, max: 40 }),
  question: words(fields, "question", "The question", { min: 5, max: 200 }),
  answer: words(fields, "answer", "The answer", { min: 5, max: 1500 }),
  shown: fields.has("shown"),
});

const questionSave = define<QuestionRow>({
  ability: "content.edit",
  read: (fields) => readQuestion(fields, whole(fields, "id", "The question", { min: 1, max: 1_000_000 })),
  async apply({ id, ...values }, staff) {
    must(staff, "content.edit");
    await db()
      .update(schema.questions)
      .set(values)
      .where(eq(schema.questions.id, id ?? -1));
    forgetContent();
    return values.shown
      ? "Saved. Guests see it."
      : "Saved, and kept back from guests until you tick “Shown to guests”.";
  },
});

const questionAdd = define<QuestionRow>({
  ability: "content.edit",
  read: (fields) => readQuestion(fields, null),
  async apply({ id: _none, ...values }, staff) {
    must(staff, "content.edit");
    const [{ next }] = await db()
      .select({ next: sql<number>`coalesce(max(${schema.questions.position}), 0) + 1` })
      .from(schema.questions);
    await db()
      .insert(schema.questions)
      .values({ ...values, position: next });
    forgetContent();
    return values.shown
      ? "Added. Guests see it."
      : "Added, and kept back from guests. Preview it, then tick “Shown to guests”.";
  },
});

const questionRemove = define<{ id: number }>({
  ability: "content.edit",
  read: (fields) => ({ id: whole(fields, "id", "The question", { min: 1, max: 1_000_000 }) }),
  async apply({ id }, staff) {
    must(staff, "content.edit");
    await db().delete(schema.questions).where(eq(schema.questions.id, id));
    forgetContent();
    return "The question is removed.";
  },
});

export const SETUP_ACTIONS = {
  prices,
  "season-add": seasonAdd,
  "season-remove": seasonRemove,
  "stay-add": stayAdd,
  "stay-remove": stayRemove,
  meals,
  extras,
  "room-type": roomType,
  "room-add": roomAdd,
  "room-change": roomChange,
  "photo-add": photoAdd,
  "photo-describe": photoDescribe,
  "photo-remove": photoRemove,
  rules,
  lodge,
  "words-draft": wordsDraft,
  "words-publish": wordsPublish,
  "words-discard": wordsDiscard,
  "page-draft": pageDraft,
  "page-publish": pagePublish,
  "page-discard": pageDiscard,
  "question-save": questionSave,
  "question-add": questionAdd,
  "question-remove": questionRemove,
} as const;

export type SetupActionName = keyof typeof SETUP_ACTIONS;

export const isSetupAction = (name: string): name is SetupActionName => name in SETUP_ACTIONS;

/** A change waiting to be confirmed, as it travels through the browser and back. */
export type Waiting = { action: SetupActionName; proposal: unknown; by: number };

/** The definition of an action, with its own kind of proposal forgotten: callers pass back what `read` gave them. */
export function setupAction(name: SetupActionName): SetupAction<unknown> {
  return SETUP_ACTIONS[name] as unknown as SetupAction<unknown>;
}
