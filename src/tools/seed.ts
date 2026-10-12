// Writes the lodge's first setup to the database: rooms, seasons, prices,
// rules and the words on the site (see src/server/setup/lodge.ts).
//
//   node seed.mjs             add whatever is missing, leave everything else alone
//   node seed.mjs --refresh   also overwrite existing rows with the setup's values
//
// Without --refresh this is safe to run on every release: it never undoes a
// change staff have made in the back office.

import { sql } from "drizzle-orm";

import { closeDatabase, db, schema, type Queryable } from "@/server/db";
import * as lodge from "@/server/setup/lodge";

export async function seedLodge(tx: Queryable, options: { refresh: boolean; years: [number, number] }): Promise<void> {
  const { refresh } = options;

  // A helper for "insert, and on a clash either update or do nothing".
  const onClash = <T extends Record<string, unknown>>(values: T) => (refresh ? values : undefined);

  {
    const insert = tx.insert(schema.settings).values({ id: true, ...lodge.settings });
    const set = onClash({ ...lodge.settings });
    await (set ? insert.onConflictDoUpdate({ target: schema.settings.id, set }) : insert.onConflictDoNothing());
  }

  for (const [position, season] of lodge.seasons.entries()) {
    const values = { code: season.code, name: season.name, isDefault: season.isDefault, position };
    const insert = tx.insert(schema.seasons).values(values);
    await (refresh
      ? insert.onConflictDoUpdate({ target: schema.seasons.code, set: { name: values.name, position } })
      : insert.onConflictDoNothing());
  }
  const seasonIds = new Map((await tx.select().from(schema.seasons)).map((row) => [row.code, row.id]));

  // Season dates and stay rules have no natural key, so they are written only
  // when there are none, or replaced whole on a refresh.
  const [{ count: seasonDateCount }] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.seasonDates);
  if (refresh || seasonDateCount === 0) {
    await tx.delete(schema.seasonDates);
    await tx.insert(schema.seasonDates).values(
      lodge.seasonDates(...options.years).map((range) => ({
        seasonId: seasonIds.get(range.season)!,
        dates: { from: range.from, to: range.to },
        label: range.label,
      })),
    );
  }

  const [{ count: ruleCount }] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.stayRules);
  if (refresh || ruleCount === 0) {
    await tx.delete(schema.stayRules);
    await tx.insert(schema.stayRules).values(
      lodge.stayRules(...options.years).map((rule) => ({
        dates: { from: rule.from, to: rule.to },
        minNights: rule.minNights,
        label: rule.label,
      })),
    );
  }

  for (const [position, type] of lodge.roomTypes.entries()) {
    const values = {
      slug: type.slug,
      name: type.name,
      tagline: type.tagline,
      description: type.description,
      sleeps: type.sleeps,
      bedrooms: type.bedrooms,
      beds: type.beds,
      sizeSqm: type.sizeSqm,
      features: [...type.features],
      position,
    };
    const insert = tx.insert(schema.roomTypes).values(values);
    const { slug: _slug, ...changes } = values;
    await (refresh
      ? insert.onConflictDoUpdate({ target: schema.roomTypes.slug, set: changes })
      : insert.onConflictDoNothing());
  }
  const typeIds = new Map((await tx.select().from(schema.roomTypes)).map((row) => [row.slug, row.id]));

  let roomPosition = 0;
  for (const type of lodge.roomTypes) {
    for (const name of type.rooms) {
      await tx
        .insert(schema.rooms)
        .values({ roomTypeId: typeIds.get(type.slug)!, name, position: roomPosition++ })
        .onConflictDoNothing();
    }

    for (const season of lodge.seasons) {
      const [weeknight, weekend] = lodge.rates[type.slug][season.code];
      const values = {
        roomTypeId: typeIds.get(type.slug)!,
        seasonId: seasonIds.get(season.code)!,
        weeknightCents: weeknight * 100,
        weekendCents: weekend * 100,
      };
      const insert = tx.insert(schema.rates).values(values);
      await (refresh
        ? insert.onConflictDoUpdate({
            target: [schema.rates.roomTypeId, schema.rates.seasonId],
            set: { weeknightCents: values.weeknightCents, weekendCents: values.weekendCents },
          })
        : insert.onConflictDoNothing());
    }
  }

  for (const [position, plan] of lodge.mealPlans.entries()) {
    const values = { ...plan, position };
    const insert = tx.insert(schema.mealPlans).values(values);
    const { code: _code, ...changes } = values;
    await (refresh
      ? insert.onConflictDoUpdate({ target: schema.mealPlans.code, set: changes })
      : insert.onConflictDoNothing());
  }

  for (const [position, extra] of lodge.extras.entries()) {
    const values = { ...extra, position };
    const insert = tx.insert(schema.extras).values(values);
    const { slug: _slug, ...changes } = values;
    await (refresh
      ? insert.onConflictDoUpdate({ target: schema.extras.slug, set: changes })
      : insert.onConflictDoNothing());
  }

  for (const [position, text] of lodge.siteText.entries()) {
    const values = { ...text, position };
    const insert = tx.insert(schema.siteText).values(values);
    await (refresh
      ? insert.onConflictDoUpdate({
          target: schema.siteText.key,
          set: { label: text.label, value: text.value, position },
        })
      : insert.onConflictDoNothing());
  }

  for (const [position, page] of lodge.pages.entries()) {
    const values = { ...page, position };
    const insert = tx.insert(schema.pages).values(values);
    await (refresh
      ? insert.onConflictDoUpdate({
          target: schema.pages.slug,
          set: { title: page.title, summary: page.summary, body: page.body, position },
        })
      : insert.onConflictDoNothing());
  }

  const [{ count: questionCount }] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.questions);
  if (refresh || questionCount === 0) {
    await tx.delete(schema.questions);
    await tx.insert(schema.questions).values(lodge.questions.map((question, position) => ({ ...question, position })));
  }
}

async function main(): Promise<void> {
  const refresh = process.argv.includes("--refresh");
  const thisYear = new Date().getUTCFullYear();

  await db().transaction((tx) => seedLodge(tx, { refresh, years: [thisYear - 1, thisYear + 2] }));
  console.log(
    refresh
      ? "The lodge's setup was written over what was there."
      : "Anything missing from the lodge's setup was added.",
  );
}

if (process.argv[1] && /seed\.(ts|mjs|js)$/.test(process.argv[1])) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closeDatabase());
}
