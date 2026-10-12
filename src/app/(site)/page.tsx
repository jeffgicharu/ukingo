import type { Metadata } from "next";
import { connection } from "next/server";

import { BookingBar } from "@/components/site/booking-bar";
import { DawnScene } from "@/components/site/dawn-scene";
import { Photo } from "@/components/site/photo";
import { SiteHeader } from "@/components/site/site-header";
import { formatMoney, plural } from "@/lib/format";
import { bookableWindow } from "@/server/booking/rules";
import { clock } from "@/server/clock";
import { catalogue } from "@/server/lodge/catalogue";
import { siteWords } from "@/server/lodge/content";

// The title, description and sharing details come from the root layout.
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  await connection();

  const [lodge, words] = await Promise.all([catalogue(), siteWords()]);
  const window = bookableWindow(lodge.settings, clock.now());
  const maxGuests = Math.max(...lodge.roomTypes.map((type) => type.sleeps));
  const roomCount = lodge.roomTypes.reduce((sum, type) => sum + type.rooms.length, 0);

  return (
    <>
      <SiteHeader over />

      <main id="main" className="flex-1">
        {/* The hero: the mountain at first light, and the question every visitor has. */}
        <section className="relative isolate flex min-h-[34rem] flex-col justify-end overflow-hidden bg-night-900 text-mist-50 md:min-h-[42rem]">
          <div className="absolute inset-0 -z-10">
            <DawnScene />
          </div>
          <div className="absolute inset-0 -z-10 bg-linear-to-t from-night-950/70 via-night-950/10 to-night-950/40" />

          <div className="wrap pb-24 pt-32 md:pb-28">
            <p className="label text-ember-300">Nanyuki · Mount Kenya</p>
            <h1 className="display mt-4 max-w-[14ch] text-[2.9rem] sm:text-6xl md:text-7xl lg:text-[5.5rem]">
              {words("home.headline")}
            </h1>
            <p className="mt-6 max-w-xl text-lg text-mist-100 md:text-xl">{words("home.introduction")}</p>
          </div>
        </section>

        {/* The booking bar sits across the edge between the hero and the page. */}
        <div className="wrap relative z-10 -mt-14">
          <BookingBar first={window.first} lastDeparture={window.lastDeparture} maxGuests={maxGuests} idPrefix="home" />
        </div>

        <section aria-labelledby="rooms-heading" className="wrap py-20 md:py-28">
          <div className="grid gap-6 md:grid-cols-[1fr_1.1fr] md:items-end">
            <div>
              <p className="label text-ink-faint">{plural(roomCount, "room")}</p>
              <h2 id="rooms-heading" className="display mt-3 text-5xl md:text-6xl">
                {words("home.rooms.heading")}
              </h2>
            </div>
            <p className="max-w-xl text-lg text-ink-soft md:justify-self-end">{words("home.rooms.introduction")}</p>
          </div>

          <ul className="mt-12 grid gap-x-8 gap-y-14 md:grid-cols-2">
            {lodge.roomTypes.map((type, index) => (
              <li key={type.id} className={index % 2 === 1 ? "md:mt-16" : ""}>
                <a href={`/rooms/${type.slug}`} className="group block">
                  <div className="overflow-hidden rounded-2xl">
                    <Photo
                      name={type.slug}
                      alt={`${type.name} at Ukingo`}
                      sizes="(min-width: 48rem) 45vw, 100vw"
                      className="aspect-4/3 w-full transition-transform duration-700 ease-settle group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="mt-5 flex items-baseline justify-between gap-4 border-b border-rule pb-4">
                    <h3 className="display text-3xl md:text-4xl">{type.name}</h3>
                    <p className="label shrink-0 text-ink-faint">Sleeps {type.sleeps}</p>
                  </div>
                  <p className="mt-4 text-ink-soft">{type.tagline}</p>
                  <p className="mt-3 font-medium">
                    From <span className="tabular">{formatMoney(type.fromCents)}</span> a night
                    <span className="ml-3 text-ember-800 underline decoration-1 underline-offset-4 group-hover:text-ink">
                      See the room
                    </span>
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="place-heading" className="contours bg-night-900 text-mist-50">
          <div className="wrap grid gap-12 py-20 md:grid-cols-2 md:items-center md:py-28">
            <div>
              <p className="label text-ember-300">The place</p>
              <h2 id="place-heading" className="display mt-3 text-5xl md:text-6xl">
                {words("home.place.heading")}
              </h2>
              <p className="mt-6 max-w-xl text-lg text-night-200">{words("home.place.body")}</p>
              <a href="/about" className="button button-line-light mt-8">
                About the lodge
              </a>
            </div>

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-rule-light">
              {[
                ["2,180 m", "above the sea"],
                [String(roomCount), "rooms, each with a fire"],
                ["14 km", "from Nanyuki town"],
                ["0°", "the equator, near enough"],
              ].map(([figure, caption]) => (
                <div key={caption} className="bg-night-900 p-6 md:p-8">
                  <dt className="display tabular text-4xl text-ember-300 md:text-5xl">{figure}</dt>
                  <dd className="mt-2 text-night-200">{caption}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="experiences-heading" className="wrap py-20 md:py-28">
          <div className="grid gap-10 md:grid-cols-[0.9fr_1.4fr]">
            <div>
              <p className="label text-ink-faint">Experiences</p>
              <h2 id="experiences-heading" className="display mt-3 text-5xl md:text-6xl">
                {words("home.experiences.heading")}
              </h2>
              <p className="mt-5 max-w-sm text-lg text-ink-soft">{words("home.experiences.introduction")}</p>
              <a href="/experiences" className="button button-line mt-8">
                All experiences
              </a>
            </div>

            <ul className="border-t border-rule">
              {lodge.extras.map((extra) => (
                <li
                  key={extra.id}
                  className="grid gap-1 border-b border-rule py-5 sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-6"
                >
                  <div>
                    <h3 className="display text-2xl md:text-[1.75rem]">{extra.name}</h3>
                    <p className="label mt-1.5 text-ink-faint">{extra.duration}</p>
                  </div>
                  <p className="tabular font-medium sm:text-right">
                    {formatMoney(extra.priceCents)}
                    <span className="font-normal text-ink-faint">
                      {" "}
                      {extra.charged === "per_person" ? "a guest" : "a booking"}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="directions-heading" className="border-t border-rule bg-mist-100">
          <div className="wrap grid gap-8 py-16 md:grid-cols-[1.4fr_1fr] md:items-center md:py-20">
            <div>
              <p className="label text-ink-faint">Getting here</p>
              <h2 id="directions-heading" className="display mt-3 text-4xl md:text-5xl">
                {words("home.directions.heading")}
              </h2>
              <p className="mt-4 max-w-xl text-lg text-ink-soft">{words("home.directions.body")}</p>
            </div>
            <div className="flex flex-wrap gap-3 md:justify-end">
              <a href="/getting-here" className="button button-line">
                Directions
              </a>
              <a href="/stay" className="button button-night">
                Check dates
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
