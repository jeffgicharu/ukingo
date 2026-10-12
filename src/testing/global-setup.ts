// Runs once before the tests: empties the test database and builds the tables
// from the migrations, exactly as a release does.

import path from "node:path";

import pg from "pg";

import { migrate } from "../tools/migrate";
import { testDatabaseUrl } from "./database-url";

export default async function setup(): Promise<void> {
  const connectionString = testDatabaseUrl();

  const client = new pg.Client({ connectionString });
  await client.connect();
  // The extension is kept: creating it can need more rights than the tests have.
  await client.query(`
    DO $$
    DECLARE item record;
    BEGIN
      FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', item.tablename);
      END LOOP;
      FOR item IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', item.sequencename);
      END LOOP;
    END $$;
    DROP SCHEMA IF EXISTS pgboss CASCADE;
  `);
  await client.end();

  await migrate({ connectionString, directory: path.resolve(process.cwd(), "migrations") });
}
