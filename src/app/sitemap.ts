import { asc } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { catalogue } from "@/server/lodge/catalogue";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();

  const [lodge, pages] = await Promise.all([
    catalogue(),
    db()
      .select({ slug: schema.pages.slug, updatedAt: schema.pages.updatedAt })
      .from(schema.pages)
      .orderBy(asc(schema.pages.position)),
  ]);
  const address = (path: string) => `${env.siteUrl}${path}`;

  return [
    { url: address("/"), changeFrequency: "weekly", priority: 1 },
    { url: address("/rooms"), changeFrequency: "weekly", priority: 0.9 },
    ...lodge.roomTypes.map((type) => ({
      url: address(`/rooms/${type.slug}`),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    { url: address("/stay"), changeFrequency: "daily", priority: 0.8 },
    { url: address("/experiences"), changeFrequency: "monthly", priority: 0.6 },
    { url: address("/questions"), changeFrequency: "monthly", priority: 0.5 },
    ...pages.map((page) => ({
      url: address(`/${page.slug}`),
      lastModified: page.updatedAt,
      changeFrequency: "monthly" as const,
      priority: page.slug === "about" || page.slug === "getting-here" ? 0.6 : 0.3,
    })),
  ];
}
