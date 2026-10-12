import type { Metadata } from "next";
import { connection } from "next/server";

import { BookingBar } from "@/components/site/booking-bar";
import { PageHeading } from "@/components/site/page-heading";
import { Photo } from "@/components/site/photo";
import { SiteHeader } from "@/components/site/site-header";
import { describePage } from "@/lib/metadata";
import { nightsIn, type Stay } from "@/lib/dates";
import { formatDay, formatMoney, formatStay, plural, theRoom } from "@/lib/format";
import { seasonName } from "@/server/booking/pricing";
import { bookableWindow, checkDates, checkParty, type StayProblem } from "@/server/booking/rules";
import { hasDates, readStayQuery, searchStay, stayAddress, type Offer } from "@/server/booking/search";
import { clock } from "@/server/clock";
import { catalogue, roomTypeBySlug, type Catalogue } from "@/server/lodge/catalogue";

export const metadata: Metadata = describePage({
  title: "Check dates and prices",
  description:
    "Choose your dates to see which rooms at Ukingo are free and what the stay costs, breakfast and taxes included. A deposit by M-Pesa confirms the booking.",
  path: "/stay",
  shareTitle: "Check dates at Ukingo",
});

export default async function StayPage({ searchParams }: PageProps<"/stay">) {
  await connection();

  const query = readStayQuery(await searchParams);
  const lodge = await catalogue();
  const now = clock.now();
  const window = bookableWindow(lodge.settings, now);
  const maxGuests = Math.max(...lodge.roomTypes.map((type) => type.sleeps));
  const party = { adults: query.adults, children: query.children };
  const onlyRoom = query.room ? roomTypeBySlug(lodge, query.room) : undefined;

  let problem: StayProblem | null = null;
  if (query.asked) {
    problem = hasDates(query)
      ? checkDates(lodge, query, now)
      : { code: "invalid_dates", message: "Choose the day you arrive and the day you leave." };
    problem ??= checkParty(lodge, party);
  }

  const stay: Stay | null = query.asked && hasDates(query) && !problem ? { from: query.from, to: query.to } : null;
  const offers = stay ? await searchStay(lodge, stay, party, now) : [];
  const shown = onlyRoom
    ? [...offers].sort((a, b) => Number(b.roomType.id === onlyRoom.id) - Number(a.roomType.id === onlyRoom.id))
    : offers;
  const anyFree = offers.some((offer) => offer.state === "free");

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <PageHeading
          label="Check dates"
          title={stay ? "What is free" : "When would you like to come?"}
          summary={
            stay
              ? `${formatStay(stay)} · ${plural(nightsIn(stay), "night")} · ${guestsLabel(party)}`
              : "Choose your dates to see which rooms are free and what the stay costs."
          }
        />

        <div className="wrap -mt-8 pb-20">
          <BookingBar
            first={window.first}
            lastDeparture={window.lastDeparture}
            maxGuests={maxGuests}
            values={{ from: query.from, to: query.to, adults: query.adults, children: query.children }}
            room={onlyRoom?.slug}
            idPrefix="stay"
          />

          {problem ? (
            <div role="alert" className="mt-8 rounded-2xl border border-heath-600/30 bg-heath-100 p-6">
              <h2 className="display text-2xl text-heath-700">Those dates cannot be booked</h2>
              <p className="mt-2 text-ink">{problem.message}</p>
            </div>
          ) : null}

          {stay ? (
            <>
              {!anyFree ? (
                <div role="status" className="mt-8 rounded-2xl bg-mist-100 p-6">
                  <h2 className="display text-2xl">Nothing is free for those dates</h2>
                  <p className="mt-2 text-ink-soft">
                    Every room that fits your party is taken for at least one of your nights. Try moving your stay by a
                    day or two, or shortening it.
                  </p>
                </div>
              ) : null}

              <h2 className="sr-only">Rooms for your dates</h2>
              <ul className="mt-10 space-y-6">
                {shown.map((offer) => (
                  <li key={offer.roomType.id}>
                    <OfferCard offer={offer} stay={stay} party={party} lodge={lodge} />
                  </li>
                ))}
              </ul>

              <p className="mt-10 max-w-2xl text-sm text-ink-faint">
                Prices are for the room, with breakfast for everyone in it and all taxes. Half board and full board can
                be added on the next page. See{" "}
                <a href="/booking-terms" className="link">
                  booking and cancellation
                </a>
                .
              </p>
            </>
          ) : (
            !problem && (
              <ul className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                {lodge.roomTypes.map((type) => (
                  <li key={type.id}>
                    <a href={`/rooms/${type.slug}`} className="group block">
                      <div className="overflow-hidden rounded-xl">
                        <Photo
                          name={type.slug}
                          alt={`${type.name} at Ukingo`}
                          sizes="(min-width: 64rem) 22vw, (min-width: 40rem) 45vw, 100vw"
                          className="aspect-4/3 w-full"
                        />
                      </div>
                      <h2 className="display mt-4 text-2xl">{type.name}</h2>
                      <p className="mt-1 text-ink-faint">
                        Sleeps {type.sleeps} · from <span className="tabular">{formatMoney(type.fromCents)}</span>
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </main>
    </>
  );
}

function guestsLabel(party: { adults: number; children: number }): string {
  const adults = plural(party.adults, "adult");
  return party.children ? `${adults}, ${plural(party.children, "child", "children")}` : adults;
}

function OfferCard({
  offer,
  stay,
  party,
  lodge,
}: {
  offer: Offer;
  stay: Stay;
  party: { adults: number; children: number };
  lodge: Catalogue;
}) {
  const { roomType } = offer;
  const nights = nightsIn(stay);
  const free = offer.state === "free" && offer.quote;

  return (
    <article
      className={`grid overflow-hidden rounded-2xl border bg-white md:grid-cols-[18rem_1fr] ${
        free ? "border-rule shadow-panel" : "border-rule"
      }`}
    >
      <div className={free ? "" : "opacity-60"}>
        <Photo
          name={roomType.slug}
          alt={`${roomType.name} at Ukingo`}
          sizes="(min-width: 48rem) 18rem, 100vw"
          className="aspect-16/9 size-full md:aspect-auto md:min-h-56"
        />
      </div>

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:gap-8">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="display text-3xl">
              <a href={`/rooms/${roomType.slug}`} className="hover:text-ember-800">
                {roomType.name}
              </a>
            </h3>
            {free && offer.free <= 2 && offer.free < roomType.rooms.length ? (
              <span className="label rounded-full bg-ember-100 px-2.5 py-1 text-ember-800">
                {offer.free === 1 ? "Last one" : `${offer.free} left`}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-ink-faint">
            Sleeps {roomType.sleeps} · {roomType.beds}
          </p>
          <p className="mt-3 max-w-xl text-ink-soft">{roomType.tagline}</p>

          {free ? (
            <details className="group mt-4">
              <summary className="link inline cursor-pointer list-none text-sm [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show the price of each night</span>
                <span className="hidden group-open:inline">Hide the price of each night</span>
              </summary>
              <table className="tabular mt-3 w-full max-w-sm text-sm">
                <tbody>
                  {offer.quote!.nights.map((night) => (
                    <tr key={night.night} className="border-t border-rule">
                      <th scope="row" className="py-2 text-left font-normal">
                        {formatDay(night.night, "compact")}
                      </th>
                      <td className="py-2 text-ink-faint">{seasonName(lodge, night.season)}</td>
                      <td className="py-2 text-right">{formatMoney(night.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </div>

        <div className="flex flex-col justify-between gap-4 lg:min-w-52 lg:items-end lg:text-right">
          {free ? (
            <>
              <div>
                <p className="display tabular text-4xl">{formatMoney(offer.quote!.totalCents)}</p>
                <p className="text-sm text-ink-faint">for {plural(nights, "night")}, with breakfast</p>
              </div>
              <a
                href={stayAddress("/book", stay, party, { room: roomType.slug })}
                className="button button-ember w-full lg:w-auto"
              >
                Book {theRoom(roomType.name)}
              </a>
            </>
          ) : (
            <p className="rounded-xl bg-mist-100 p-4 text-left text-sm text-ink-soft lg:max-w-60">
              {offer.state === "too_small" ? (
                <>
                  <span className="font-semibold text-ink">Too small for your party.</span> Sleeps {roomType.sleeps}.
                </>
              ) : offer.fullNights.length ? (
                <>
                  <span className="font-semibold text-ink">Full on {listDays(offer.fullNights)}.</span> Other dates may
                  be free.
                </>
              ) : (
                <>
                  <span className="font-semibold text-ink">No one room is free for all your nights.</span> A shorter
                  stay may fit.
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function listDays(days: string[]): string {
  const names = days.map((day) => formatDay(day, "compact"));
  if (names.length <= 3) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more nights`;
}
