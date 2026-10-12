// Settings read from the environment. Each is read when first used, so a
// build or a test that never touches the database does not need its address.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function flag(name: string): boolean {
  return process.env[name] === "true";
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },

  /** The public address of the site, without a trailing slash. Fixed when the site is built. */
  get siteUrl(): string {
    return (process.env.SITE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
  },

  /** The commit this build was made from. */
  get release(): string {
    return process.env.RELEASE ?? "dev";
  },

  /** Search engines are asked not to list the site unless this is switched on. */
  get allowIndexing(): boolean {
    return flag("ALLOW_INDEXING");
  },

  get databasePoolSize(): number {
    return Number(process.env.DATABASE_POOL ?? 5);
  },
};
