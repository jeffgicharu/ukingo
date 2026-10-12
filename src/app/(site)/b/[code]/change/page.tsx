import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { SiteHeader } from "@/components/site/site-header";
import { addDays, isDay, nightsIn } from "@/lib/dates";
import { formatDay, formatMoney, formatStay, plural } from "@/lib/format";
import { privatePage } from "@/lib/metadata";
import { bookingPath } from "@/server/booking/links";
import { bookableWindow, mayChangeDates, resolveTerms } from "@/server/booking/rules";
import { previewDateChange } from "@/server/booking/service";
import { bookingForLink, viewOf } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { readFlash } from "@/server/flash";
import { catalogue } from "@/server/lodge/catalogue";

export const metadata: Metadata = privatePage("Change your dates");

export default async function ChangePage({ params, searchParams }: PageProps<"/b/[code]/change">) {
  await connection();
  const { code } = await params;
  const query = await searchParams;
  const booking = await bookingForLink(code);
  if (!booking) notFound();

  const now = clock.now();
  const view = await viewOf(booking, now);
  const home = bookingPath(booking);
  if (booking.status !== "confirmed" || !mayChangeDates(booking.terms, view.today)) redirect(home);

  const lodge = await catalogue();
  const window = bookableWindow(lodge.settings, now);
  const from = typeof query.in === "string" ? query.in : undefined;
  const to = typeof query.out === "string" ? query.out : undefined;
  const asked = isDay(from) && isDay(to) ? { from, to } : null;
  const preview = asked ? await previewDateChange(booking, asked, { actor: "guest" }, now) : null;
  const note = readFlash(query.note);
  const newTerms =
    asked && preview?.ok ? resolveTerms(booking.terms.policy, asked, preview.totalCents, view.today) : null;
  const owedAfter = preview?.ok ? Math.max(0, preview.totalCents - view.money.heldCents) : 0;

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="wrap py-10 md:py-14">
          <div className="max-w-3xl">
            <nav aria-label="You are here" className="label text-ink-faint">
              <a href={home} className="underline-offset-4 hover:text-ink hover:underline">
                Booking {booking.reference}
              </a>
              <span aria-hidden="true" className="mx-2">
                /
              </span>
              <span aria-current="page">Change dates</span>
            </nav>

            <h1 className="display mt-4 text-5xl md:text-6xl">Move your stay</h1>
            <p className="mt-3 text-lg text-ink-soft">
              You have the {view.roomType.name} for {formatStay(booking.stay)}, {plural(view.nights.length, "night")}.
              New dates are charged at their own prices.
            </p>

            {note ? (
              <div role="alert" className="mt-7 rounded-2xl border border-heath-600/30 bg-heath-100 p-5">
                <p>{note}</p>
              </div>
            ) : null}

            <form
              action={bookingPath(booking, "/change")}
              method="get"
              className="mt-8 rounded-2xl border border-rule bg-white p-5"
            >
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div>
                  <label htmlFor="change-in" className="field-label">
                    New arrival
                  </label>
                  <input
                    id="change-in"
                    type="date"
                    name="in"
                    required
                    defaultValue={asked?.from ?? booking.stay.from}
                    min={window.first}
                    max={addDays(window.lastDeparture, -1)}
                    className="field tabular"
                  />
                </div>
                <div>
                  <label htmlFor="change-out" className="field-label">
                    New departure
                  </label>
                  <input
                    id="change-out"
                    type="date"
                    name="out"
                    required
                    defaultValue={asked?.to ?? booking.stay.to}
                    min={addDays(window.first, 1)}
                    max={window.lastDeparture}
                    className="field tabular"
                  />
                </div>
                <button type="submit" className="button button-night col-span-2 sm:col-span-1">
                  Check these dates
                </button>
              </div>
            </form>

            {asked && preview && !preview.ok ? (
              <div role="alert" className="mt-6 rounded-2xl bg-mist-100 p-6">
                <h2 className="display text-2xl">Those dates will not work</h2>
                <p className="mt-2 text-ink-soft">{preview.reason}</p>
              </div>
            ) : null}

            {asked && preview?.ok && !preview.roomFree ? (
              <div role="alert" className="mt-6 rounded-2xl bg-mist-100 p-6">
                <h2 className="display text-2xl">The {view.roomType.name} is full for those dates</h2>
                <p className="mt-2 text-ink-soft">
                  No {view.roomType.name} is free for every night from {formatStay(asked)}. Try other dates.
                </p>
              </div>
            ) : null}

            {asked && preview?.ok && preview.roomFree && newTerms ? (
              <section aria-labelledby="change-preview" className="mt-6 rounded-2xl bg-mist-100 p-6 md:p-8">
                <h2 id="change-preview" className="display text-3xl">
                  {formatStay(asked)}
                </h2>
                <p className="mt-1 text-ink-soft">
                  {plural(nightsIn(asked), "night")} in the {view.roomType.name}. It is free.
                </p>

                <dl className="mt-5 border-t border-rule">
                  <div className="flex justify-between gap-4 border-b border-rule py-3">
                    <dt className="text-ink-soft">Your stay costs now</dt>
                    <dd className="tabular">{formatMoney(booking.totalCents)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-rule py-3">
                    <dt className="text-ink-soft">The new dates cost</dt>
                    <dd className="tabular font-medium">{formatMoney(preview.totalCents)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-rule py-3">
                    <dt className="text-ink-soft">Difference</dt>
                    <dd className="tabular font-medium">
                      {preview.differenceCents === 0
                        ? "None"
                        : preview.differenceCents > 0
                          ? `${formatMoney(preview.differenceCents)} more`
                          : `${formatMoney(-preview.differenceCents)} less`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-rule py-3">
                    <dt className="text-ink-soft">You have paid</dt>
                    <dd className="tabular">{formatMoney(view.money.heldCents)}</dd>
                  </div>
                  {preview.refundCents > 0 ? (
                    <div className="flex items-baseline justify-between gap-4 py-3">
                      <dt className="font-semibold">We refund</dt>
                      <dd className="display tabular text-3xl">{formatMoney(preview.refundCents)}</dd>
                    </div>
                  ) : (
                    <div className="flex items-baseline justify-between gap-4 py-3">
                      <dt className="font-semibold">
                        Still to pay
                        {owedAfter > 0
                          ? newTerms.balance_due
                            ? `, by ${formatDay(newTerms.balance_due, "long")}`
                            : ", straight away"
                          : ""}
                      </dt>
                      <dd className="display tabular text-3xl">{formatMoney(owedAfter)}</dd>
                    </div>
                  )}
                </dl>

                <form
                  action={bookingPath(booking, "/change/confirm")}
                  method="post"
                  className="mt-6 flex flex-wrap gap-3"
                >
                  <input type="hidden" name="in" value={asked.from} />
                  <input type="hidden" name="out" value={asked.to} />
                  <button type="submit" className="button button-ember">
                    Move my stay to these dates
                  </button>
                  <a href={home} className="button button-line">
                    Keep my dates
                  </a>
                </form>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
