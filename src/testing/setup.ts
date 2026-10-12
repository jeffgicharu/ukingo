// Runs in every test file, before anything is imported.

import { afterAll } from "vitest";

import { testDatabaseUrl } from "./database-url";

// The tests never lean on the machine's own time zone. Each one names the
// moment it runs at.
process.env.TZ = "UTC";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.APP_SECRET ??= "test-secret-test-secret-test-secret-test";
process.env.SITE_URL ??= "https://ukingo.test";

afterAll(async () => {
  const { closeDatabase } = await import("@/server/db");
  await closeDatabase();
});
