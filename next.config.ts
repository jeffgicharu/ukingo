import type { NextConfig } from "next";

// The commit this build was made from. The deploy pipeline sets it; a local
// build is simply "dev".
const release = process.env.RELEASE ?? "dev";

// The public address of the site. It is part of every page (links for search
// engines and for sharing), so it is fixed when the site is built.
const siteUrl = (process.env.SITE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // One self-contained folder is uploaded to the server. Nothing is installed there.
  output: "standalone",

  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,

  // Every visitor gets what a search engine gets: one finished page, with its
  // title and description in place and the right status code. Nothing is sent
  // ahead of the page as a shell to be filled in by script.
  htmlLimitedBots: /.*/,

  poweredByHeader: false,
  // nginx compresses responses. Doing it twice wastes time and holds back streams.
  compress: false,

  // A browser holding pages from the previous release reloads instead of
  // mixing two releases together.
  deploymentId: release === "dev" ? undefined : release,

  env: {
    RELEASE: release,
    SITE_URL: siteUrl,
  },

  serverExternalPackages: ["pg", "pg-boss"],

  // The public folder is shipped whole beside the server. Code that reads
  // photographs from disk would otherwise have copies of it traced in as well.
  outputFileTracingExcludes: {
    "/**": ["public/**/*"],
  },

  // Each photograph's address ends in a stamp that changes when the photograph
  // does, so a browser may keep its copy for a year and never ask again.
  async headers() {
    return [
      {
        source: "/photos/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },

  experimental: {
    // Pages here wait for their data on purpose (see `instant` in the root
    // layout), so the development overlay only checks pages that ask for it.
    instantInsights: { validationLevel: "manual-warning" },
  },

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
