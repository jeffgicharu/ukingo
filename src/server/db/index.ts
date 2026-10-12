import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { env } from "../env";
import * as schema from "./schema";

// Calendar dates stay text ("2026-11-13"). Turned into a JavaScript Date they
// would pick up the server's time zone and could slip a day.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// Money is whole cents in a bigint column. Every amount here fits a JavaScript number exactly.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction: anything a query can run on. */
export type Queryable = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;

type Shared = { pool?: pg.Pool; db?: Database };

// One pool per process, kept across hot reloads in development.
const shared = globalThis as typeof globalThis & { __ukingo?: Shared };
const state: Shared = (shared.__ukingo ??= {});

export function pool(): pg.Pool {
  if (!state.pool) {
    state.pool = new pg.Pool({
      connectionString: env.databaseUrl,
      max: env.databasePoolSize,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: process.env.DATABASE_APP_NAME ?? "ukingo",
      options: "-c timezone=UTC",
    });
    // A dropped idle connection must not take the process down with it.
    state.pool.on("error", (error) => {
      console.error("database connection lost", error.message);
    });
  }
  return state.pool;
}

export function db(): Database {
  return (state.db ??= drizzle(pool(), { schema }));
}

/** For tests and one-off tools: closes the pool so the process can end. */
export async function closeDatabase(): Promise<void> {
  const open = state.pool;
  state.pool = undefined;
  state.db = undefined;
  await open?.end();
}

/** PostgreSQL's code for a broken exclusion constraint: the nights are taken. */
export const EXCLUSION_VIOLATION = "23P01";
export const UNIQUE_VIOLATION = "23505";

export function violates(error: unknown, code: string, constraint?: string): boolean {
  // Drizzle wraps the driver's error, so look through the chain of causes.
  for (
    let current = error as { code?: string; constraint?: string; cause?: unknown } | undefined, depth = 0;
    current && depth < 5;
    depth++
  ) {
    if (current.code === code && (!constraint || current.constraint === constraint)) {
      return true;
    }
    current = current.cause as typeof current;
  }
  return false;
}

export { schema };
