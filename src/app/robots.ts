import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { env } from "@/server/env";

// Crawlers may read the public pages. Whether those pages may be listed is
// decided by a header on every response (see src/proxy.ts), which a crawler
// can only see if it is allowed to fetch the page. So nothing public is
// blocked here. Private areas are.
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/desk", "/b/", "/book", "/find-booking", "/hooks/"],
      },
    ],
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
