import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { JsonLd } from "@/components/site/json-ld";
import { PageHeading } from "@/components/site/page-heading";
import { Photo } from "@/components/site/photo";
import { SiteHeader } from "@/components/site/site-header";
import { describePage } from "@/lib/metadata";
import { formatMoney, plural, theRoom } from "@/lib/format";
import { catalogue } from "@/server/lodge/catalogue";
import { lodgeData, trail } from "@/server/lodge/structured-data";

export const metadata: Metadata = describePage({
  title: "Rooms: cottages, tents and a house for eight",
  description:
    "Twelve rooms on the edge of the Mount Kenya forest: stone cottages with fires, canvas tents facing the peaks, two-bedroom family cottages and a farmhouse for eight. Prices per room, breakfast included.",
  path: "/rooms",
  shareTitle: "Rooms at Ukingo",
});

export default async function RoomsPage() {
  await connection();
  const lodge = await catalogue();
  const roomCount = lodge.roomTypes.reduce((sum, type) => sum + type.rooms.length, 0);

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <PageHeading
          label={`${plural(roomCount, "room")} · Breakfast included`}
          title="Rooms"
          summary="Every price is for the room, not per person, and includes breakfast for everyone in it. Each room has its own fire."
        />

        <div className="wrap py-16 md:py-24">
          <ul className="space-y-20 md:space-y-28">
            {lodge.roomTypes.map((type, index) => (
              <li key={type.id} className="grid gap-8 md:grid-cols-2 md:items-center md:gap-14">
                <Link
                  href={`/rooms/${type.slug}`}
                  className={`block overflow-hidden rounded-2xl ${index % 2 === 1 ? "md:order-2" : ""}`}
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  <Photo
                    name={type.slug}
                    alt={`${type.name} at Ukingo`}
                    sizes="(min-width: 48rem) 45vw, 100vw"
                    priority={index === 0}
                    className="aspect-4/3 w-full"
                  />
                </Link>

                <div>
                  <p className="label text-ink-faint">
                    Sleeps {type.sleeps} · {type.rooms.length === 1 ? "One only" : `${type.rooms.length} of these`}
                  </p>
                  <h2 className="display mt-3 text-4xl md:text-5xl">
                    <Link href={`/rooms/${type.slug}`} className="hover:text-ember-800">
                      {type.name}
                    </Link>
                  </h2>
                  <p className="mt-4 text-lg text-ink-soft">{type.tagline}</p>

                  <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-rule py-5 text-sm">
                    <div>
                      <dt className="label text-ink-faint">Beds</dt>
                      <dd className="mt-1 text-base">{type.beds}</dd>
                    </div>
                    {type.sizeSqm ? (
                      <div>
                        <dt className="label text-ink-faint">Size</dt>
                        <dd className="mt-1 text-base">{type.sizeSqm} m²</dd>
                      </div>
                    ) : null}
                  </dl>

                  <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4">
                    <p className="text-lg font-medium">
                      From <span className="tabular">{formatMoney(type.fromCents)}</span>{" "}
                      <span className="font-normal text-ink-faint">a night</span>
                    </p>
                    <Link href={`/rooms/${type.slug}`} className="button button-night">
                      See {theRoom(type.name)}
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </main>

      <JsonLd data={lodgeData(lodge)} />
      <JsonLd
        data={trail([
          { name: "Ukingo", path: "/" },
          { name: "Rooms", path: "/rooms" },
        ])}
      />
    </>
  );
}
