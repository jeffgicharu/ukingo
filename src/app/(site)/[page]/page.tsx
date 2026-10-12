import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { JsonLd } from "@/components/site/json-ld";
import { PageHeading } from "@/components/site/page-heading";
import { Photo } from "@/components/site/photo";
import { Previewed } from "@/components/site/preview-banner";
import { Prose } from "@/components/site/prose";
import { SiteHeader } from "@/components/site/site-header";
import { describePage } from "@/lib/metadata";
import { photos } from "@/photos/manifest";
import { page as findPage } from "@/server/lodge/content";
import { isPreview } from "@/server/lodge/preview";
import { trail } from "@/server/lodge/structured-data";

// The pages staff write: about, getting here, the booking terms and so on.
// An address that names no page gets the "not found" page.

/** The photograph that opens a page, where there is one for it. */
const pictures: Record<string, { name: string; alt: string }> = {
  about: { name: "lodge-evening", alt: "Ukingo at dusk: lit windows under the cedars, with Mount Kenya behind" },
  "getting-here": { name: "the-road", alt: "The last stretch of murram road, climbing towards the forest" },
};

const labels: Record<string, string> = {
  about: "The lodge",
  "getting-here": "Plan your journey",
  "booking-terms": "The small print",
  privacy: "The small print",
  terms: "The small print",
};

export async function generateMetadata({ params }: PageProps<"/[page]">): Promise<Metadata> {
  await connection();
  const { page: slug } = await params;
  const found = await findPage(slug);
  if (!found) return { title: "Page not found" };

  return describePage({ title: found.title, description: found.summary, path: `/${found.slug}` });
}

export default async function ContentPage({ params, searchParams }: PageProps<"/[page]">) {
  await connection();
  const { page: slug } = await params;
  const preview = await isPreview(await searchParams);
  const found = await findPage(slug, { preview });
  if (!found) notFound();
  const picture = pictures[found.slug];

  return (
    <Previewed on={preview} back={`/desk/pages?tab=pages&page=${found.slug}`}>
      <SiteHeader />
      <main id="main" className="flex-1">
        <PageHeading label={labels[found.slug] ?? "Ukingo"} title={found.title} summary={found.summary} />

        <div className="wrap grid gap-12 py-14 md:grid-cols-[1fr_18rem] md:gap-16 md:py-20">
          <div>
            {picture && photos[picture.name] ? (
              <div className="mb-10 overflow-hidden rounded-2xl">
                <Photo
                  name={picture.name}
                  alt={picture.alt}
                  sizes="(min-width: 48rem) 60vw, 100vw"
                  className="aspect-4/3 w-full md:aspect-16/9"
                  priority
                />
              </div>
            ) : null}
            <Prose text={found.body} />
          </div>

          <aside className="md:pt-2">
            <div className="rounded-2xl bg-mist-100 p-6 md:sticky md:top-8">
              <h2 className="display text-2xl">Ready to come?</h2>
              <p className="mt-2 text-ink-soft">See which rooms are free for your dates.</p>
              <a href="/stay" className="button button-night mt-5 w-full">
                Check dates
              </a>
              {found.slug === "getting-here" ? (
                <a
                  href="https://www.google.com/maps/search/?api=1&query=0.0500,37.1500"
                  rel="noopener noreferrer"
                  className="button button-line mt-3 w-full"
                >
                  Open the map pin
                </a>
              ) : null}
            </div>
          </aside>
        </div>
      </main>

      <JsonLd
        data={trail([
          { name: "Ukingo", path: "/" },
          { name: found.title, path: `/${found.slug}` },
        ])}
      />
    </Previewed>
  );
}
