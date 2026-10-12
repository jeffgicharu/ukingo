import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** The address of the database the tests may empty and rebuild. */
export function testDatabaseUrl(): string {
  let url = process.env.DATABASE_URL_TEST;

  if (!url) {
    // Developers keep it in .env.local, which the test runner does not read by itself.
    const file = path.resolve(process.cwd(), ".env.local");
    if (existsSync(file)) {
      const line = readFileSync(file, "utf8")
        .split("\n")
        .find((entry) => entry.startsWith("DATABASE_URL_TEST="));
      url = line?.slice("DATABASE_URL_TEST=".length).trim();
    }
  }

  if (!url) {
    throw new Error("DATABASE_URL_TEST is not set. The tests need a database of their own.");
  }
  if (!/test/.test(new URL(url).pathname)) {
    throw new Error("Refusing to run the tests against a database whose name does not contain 'test'.");
  }
  return url;
}
