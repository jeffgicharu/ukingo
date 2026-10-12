import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { BookingBar } from "@/components/site/booking-bar";
import { JsonLd } from "@/components/site/json-ld";
import { Photo } from "@/components/site/photo";
import { SiteHeader } from "@/components/site/site-header";
import { formatMoney, theRoom } from "@/lib/format";
import { describePage } from "@/lib/metadata";
import { bookableWindow } from "@/server/booking/rules";
import { clock } from "@/server/clock";
import { catalogue, roomTypeBySlug } from "@/server/lodge/catalogue";
import { roomData, trail } from "@/server/lodge/structured-data";

export async function generateMetadata({ params }: PageProps<"/rooms/[slug]">): Promise<Metadata> {
  await connection();
  const { slug } = await params;
  const type = roomTypeBySlug(await catalogue(), slug);
  if (!type) return { title: "Room not found" };

  return describePage({
    title: `${type.name}: sleeps ${type.sleeps}, from ${formatMoney(type.fromCents)} a night`,
    description: `${type.tagline} Sleeps ${type.sleeps}. From ${formatMoney(type.fromCents)} a night with breakfast, at Ukingo near Nanyuki.`,
    path: `/rooms/${type.slug}`,
    shareTitle: `${type.name} at Ukingo`,
  });
}

export default async function RoomPage({ params }: PageProps<"/rooms/[slug]">) {
  await connection();
  const { slug } = await params;
  const lodge = await catalogue();
  const type = roomTypeBySlug(lodge, slug);
  if (!type) notFound();

  const window = bookableWindow(lodge.settings, clock.now());
  const others = lodge.roomTypes.filter((other) => other.id !== type.id);

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="wrap pt-8 md:pt-12">
          <nav aria-label="You are here" className="label text-ink-faint">
            <a href="/rooms" className="underline-offset-4 hover:text-ink hover:underline">
              Rooms
            </a>
            <span aria-hidden="true" className="mx-2">
              /
            </span>
            <span aria-current="page">{type.name}</span>
          </nav>

          <div className="mt-5 grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end">
            <h1 className="display text-5xl md:text-7xl">{type.name}</h1>
            <p className="text-lg text-ink-soft md:pb-2 md:text-xl">{type.tagline}</p>
          </div>

          {/* One large photograph and two beside it. On a phone they stack. */}
          <div className="mt-8 grid gap-3 md:grid-cols-[2fr_1fr] md:gap-4">
            <div className="overflow-hidden rounded-2xl">
              <Photo
                name={type.slug}
                alt={`${type.name} at Ukingo`}
                sizes="(min-width: 48rem) 62vw, 100vw"
                priority
                className="aspect-4/3 w-full md:aspect-auto md:h-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-4">
              <div className="overflow-hidden rounded-2xl">
                <Photo
                  name={`${type.slug}-inside`}
                  alt={`Inside ${theRoom(type.name)}`}
                  sizes="(min-width: 48rem) 31vw, 50vw"
                  className="aspect-4/3 w-full"
                />
              </div>
              <div className="overflow-hidden rounded-2xl">
                <Photo
                  name={`${type.slug}-detail`}
                  alt={`A detail of ${theRoom(type.name)}`}
                  sizes="(min-width: 48rem) 31vw, 50vw"
                  className="aspect-4/3 w-full"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="wrap grid gap-12 py-14 md:grid-cols-[1.5fr_1fr] md:gap-16 md:py-20">
          <div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-rule py-6 sm:grid-cols-4">
              <div>
                <dt className="label text-ink-faint">Sleeps</dt>
                <dd className="display mt-1 text-3xl">{type.sleeps}</dd>
              </div>
              <div>
                <dt className="label text-ink-faint">Bedrooms</dt>
                <dd className="display mt-1 text-3xl">{type.bedrooms}</dd>
              </div>
              {type.sizeSqm ? (
                <div>
                  <dt className="label text-ink-faint">Size</dt>
                  <dd className="display mt-1 text-3xl">{type.sizeSqm} m²</dd>
                </div>
              ) : null}
              <div>
                <dt className="label text-ink-faint">Of these</dt>
                <dd className="display mt-1 text-3xl">{type.rooms.length}</dd>
              </div>
            </dl>

            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ink-soft">{type.description}</p>
            <p className="mt-4 text-ink-soft">
              <span className="font-medium text-ink">Beds:</span> {type.beds}.
            </p>

            <h2 className="display mt-12 text-3xl md:text-4xl">In the room</h2>
            <ul className="mt-5 grid gap-x-8 sm:grid-cols-2">
              {type.features.map((feature) => (
                <li key={feature} className="flex gap-3 border-b border-rule py-3">
                  <span aria-hidden="true" className="mt-[0.7em] h-px w-3 shrink-0 bg-ember-600" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <aside aria-labelledby="prices-heading">
            <div className="rounded-2xl bg-mist-100 p-6 md:p-7">
              <h2 id="prices-heading" className="display text-3xl">
                A night costs
              </h2>
              <table className="mt-4 w-full text-left">
                <thead>
                  <tr className="label text-ink-faint">
                    <th scope="col" className="pb-2 font-semibold">
                      Season
                    </th>
                    <th scope="col" className="pb-2 text-right font-semibold">
                      Sun to Thu
                    </th>
                    <th scope="col" className="pb-2 text-right font-semibold">
                      Fri, Sat
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {lodge.seasons
                    .filter((season) => type.rates[season.code])
                    .sort((a, b) => type.rates[a.code].weeknight - type.rates[b.code].weeknight)
                    .map((season) => (
                      <tr key={season.code} className="border-t border-rule">
                        <th scope="row" className="py-3 pr-2 font-medium">
                          {season.name}
                        </th>
                        <td className="py-3 text-right">{formatMoney(type.rates[season.code].weeknight)}</td>
                        <td className="py-3 text-right">{formatMoney(type.rates[season.code].weekend)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="mt-4 text-sm text-ink-faint">
                For the room, with breakfast for everyone in it. Taxes included. Enter your dates to see the exact
                price.
              </p>
            </div>
          </aside>
        </div>

        <section aria-labelledby="dates-heading" className="contours bg-night-900 text-mist-50">
          <div className="wrap py-14 md:py-20">
            <h2 id="dates-heading" className="display text-4xl md:text-5xl">
              Is {theRoom(type.name)} free?
            </h2>
            <p className="mt-3 max-w-xl text-night-200">
              Choose your dates. A {lodge.settings.depositPercent}% deposit by M-Pesa confirms the booking.
            </p>
            <div className="mt-8">
              <BookingBar
                first={window.first}
                lastDeparture={window.lastDeparture}
                maxGuests={type.sleeps}
                room={type.slug}
                idPrefix="room"
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="others-heading" className="wrap py-16 md:py-20">
          <h2 id="others-heading" className="display text-3xl md:text-4xl">
            The other rooms
          </h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-3">
            {others.map((other) => (
              <li key={other.id}>
                <a href={`/rooms/${other.slug}`} className="group block">
                  <div className="overflow-hidden rounded-xl">
                    <Photo
                      name={other.slug}
                      alt={`${other.name} at Ukingo`}
                      sizes="(min-width: 40rem) 30vw, 100vw"
                      className="aspect-4/3 w-full transition-transform duration-700 ease-settle group-hover:scale-[1.03]"
                    />
                  </div>
                  <h3 className="display mt-4 text-2xl">{other.name}</h3>
                  <p className="mt-1 text-ink-faint">
                    Sleeps {other.sleeps} · from <span className="tabular">{formatMoney(other.fromCents)}</span>
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <JsonLd data={roomData(type)} />
      <JsonLd
        data={trail([
          { name: "Ukingo", path: "/" },
          { name: "Rooms", path: "/rooms" },
          { name: type.name, path: `/rooms/${type.slug}` },
        ])}
      />
    </>
  );
}
