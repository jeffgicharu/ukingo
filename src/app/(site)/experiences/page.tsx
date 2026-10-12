import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { JsonLd } from "@/components/site/json-ld";
import { PageHeading } from "@/components/site/page-heading";
import { Photo } from "@/components/site/photo";
import { SiteHeader } from "@/components/site/site-header";
import { describePage } from "@/lib/metadata";
import { formatMoney } from "@/lib/format";
import { catalogue } from "@/server/lodge/catalogue";
import { trail } from "@/server/lodge/structured-data";

export const metadata: Metadata = describePage({
  title: "Experiences: forest walks, rides and game drives",
  description:
    "What to do at Ukingo: guided walks in the Mount Kenya forest, horse rides on the plains, conservancy game drives and dinner under the cedars. Add any of them when you book.",
  path: "/experiences",
  shareTitle: "Experiences at Ukingo",
});

export default async function ExperiencesPage() {
  await connection();
  const lodge = await catalogue();

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <PageHeading
          label="Experiences"
          title="While you are here"
          summary="Walk, ride, or do nothing at all. Anything on this page can be added when you book, and paid for with your stay."
        />

        <div className="wrap py-16 md:py-24">
          <ul className="grid gap-x-10 gap-y-16 md:grid-cols-2">
            {lodge.extras.map((extra, index) => (
              <li key={extra.id}>
                <div className="overflow-hidden rounded-2xl">
                  <Photo
                    name={extra.slug}
                    alt={extra.name}
                    sizes="(min-width: 48rem) 45vw, 100vw"
                    priority={index === 0}
                    className="aspect-3/2 w-full"
                  />
                </div>
                <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule pb-4">
                  <h2 className="display text-3xl md:text-4xl">{extra.name}</h2>
                  <p className="label text-ink-faint">{extra.duration}</p>
                </div>
                <p className="mt-4 text-ink-soft">{extra.description}</p>
                <p className="tabular mt-3 font-medium">
                  {formatMoney(extra.priceCents)}
                  <span className="font-normal text-ink-faint">
                    {" "}
                    {extra.charged === "per_person" ? "a guest" : "a booking"}
                  </span>
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-20 flex flex-col items-start gap-5 rounded-2xl bg-mist-100 p-8 md:flex-row md:items-center md:justify-between md:p-10">
            <div>
              <h2 className="display text-3xl md:text-4xl">Choose your dates first</h2>
              <p className="mt-2 text-ink-soft">You add experiences on the next page, after picking a room.</p>
            </div>
            <Link href="/stay" className="button button-night shrink-0">
              Check dates
            </Link>
          </div>
        </div>
      </main>

      <JsonLd
        data={trail([
          { name: "Ukingo", path: "/" },
          { name: "Experiences", path: "/experiences" },
        ])}
      />
    </>
  );
}
