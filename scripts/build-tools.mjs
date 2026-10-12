// Builds the command-line tools that run on the server beside the site:
// the migrator, the seeder, the release check, the background jobs and the
// tool that adds the first member of staff.
// Each becomes one self-contained file in dist/tools, so the server needs
// nothing installed to run them.

import { build } from "esbuild";

const release = process.env.RELEASE ?? "dev";

await build({
  entryPoints: {
    migrate: "src/tools/migrate.ts",
    seed: "src/tools/seed.ts",
    "check-release": "src/tools/check-release.ts",
    jobs: "src/jobs/main.ts",
    staff: "src/tools/staff.ts",
  },
  outdir: "dist/tools",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
  // pg tries an optional native driver that is not used here.
  external: ["pg-native"],
  define: {
    "process.env.RELEASE": JSON.stringify(release),
  },
  // Some bundled packages are CommonJS and expect `require` to exist.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
