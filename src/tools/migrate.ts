// Brings the database up to date. Each file in /migrations runs once, in
// name order, inside its own transaction, and is recorded so that it never
// runs again. A file that has already run must not be edited: add a new one.
//
//   node migrate.mjs            run what has not run yet
//   node migrate.mjs --status   list what has and has not run

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

const LOCK_KEY = 5_417_021; // any number, as long as every migrator uses the same one

export type MigrationResult = { applied: string[]; pending: string[] };

export async function migrate(options: {
  connectionString: string;
  directory: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<MigrationResult> {
  const log = options.log ?? (() => {});
  const client = new pg.Client({ connectionString: options.connectionString });
  await client.connect();

  try {
    // Two releases must never migrate at the same moment.
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const files = (await readdir(options.directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    const done = new Map(
      (await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations")).rows.map(
        (row) => [row.name, row.checksum],
      ),
    );

    const applied: string[] = [];
    const pending: string[] = [];

    for (const name of files) {
      const sql = await readFile(path.join(options.directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const recorded = done.get(name);

      if (recorded) {
        if (recorded !== checksum) {
          throw new Error(`${name} has changed since it was applied. Add a new migration instead of editing it.`);
        }
        continue;
      }

      pending.push(name);
      if (options.dryRun) continue;

      log(`applying ${name}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`${name} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(name);
    }

    return { applied, pending };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const directory = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "migrations");
  const dryRun = process.argv.includes("--status");

  const result = await migrate({ connectionString, directory, dryRun, log: console.log });

  if (dryRun) {
    console.log(
      result.pending.length ? `Not yet applied: ${result.pending.join(", ")}` : "The database is up to date.",
    );
  } else {
    console.log(result.applied.length ? `Applied ${result.applied.length} migration(s).` : "Nothing to apply.");
  }
}

// Run when called directly, not when imported by the tests.
if (process.argv[1] && /migrate\.(ts|mjs|js)$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
