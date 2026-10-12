// The words on the site that staff can change: home page text, pages, questions.

import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/server/db";

export type Page = { slug: string; title: string; summary: string; body: string; updatedAt: Date };
export type Question = { id: number; topic: string; question: string; answer: string };

const FRESH_FOR_MS = 15_000;

function remembered<T>(load: () => Promise<T>): { get: () => Promise<T>; forget: () => void } {
  let kept: { at: number; value: Promise<T> } | undefined;
  return {
    get() {
      const now = Date.now();
      if (!kept || now - kept.at > FRESH_FOR_MS) {
        const value = load();
        kept = { at: now, value };
        value.catch(() => {
          if (kept?.value === value) kept = undefined;
        });
      }
      return kept.value;
    },
    forget() {
      kept = undefined;
    },
  };
}

const words = remembered(async () => {
  const rows = await db().select().from(schema.siteText);
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, string>;
});

const allQuestions = remembered(async (): Promise<Question[]> => {
  const rows = await db().select().from(schema.questions).orderBy(asc(schema.questions.position));
  return rows.map((row) => ({ id: row.id, topic: row.topic, question: row.question, answer: row.answer }));
});

/** The short pieces of text placed around the site, by key. A missing key reads as "". */
export async function siteWords(): Promise<(key: string) => string> {
  const all = await words.get();
  return (key) => all[key] ?? "";
}

export function questions(): Promise<Question[]> {
  return allQuestions.get();
}

/** A published page, or null when there is none at that address. */
export async function page(slug: string): Promise<Page | null> {
  const [row] = await db().select().from(schema.pages).where(eq(schema.pages.slug, slug));
  if (!row) return null;
  return { slug: row.slug, title: row.title, summary: row.summary, body: row.body, updatedAt: row.updatedAt };
}

/** Call after staff publish a change, so the next visitor sees it. */
export function forgetContent(): void {
  words.forget();
  allQuestions.forget();
}
