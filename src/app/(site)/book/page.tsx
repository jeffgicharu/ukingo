import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { connection } from "next/server";

import { BookingChoices } from "@/components/site/booking-choices";
import { SiteHeader } from "@/components/site/site-header";
import { lodgeDay, nightsIn } from "@/lib/dates";
import { formatDay, formatStay, plural, theRoom } from "@/lib/format";
import { privatePage } from "@/lib/metadata";
import { freeCountByType } from "@/server/booking/availability";
import { extraCharge, mealCharges, quote } from "@/server/booking/pricing";
import { checkDates, checkParty, fits, termsFor } from "@/server/booking/rules";
import { defaultMealPlan, hasDates, readStayQuery, stayAddress } from "@/server/booking/search";
import { clock } from "@/server/clock";
import { catalogue, roomTypeBySlug } from "@/server/lodge/catalogue";
import { cancellationLines } from "@/server/messages/templates";

export const metadata: Metadata = privatePage("Your details");

const problems: Record<string, { title: string; text: string }> = {
  full: {
    title: "That room has just been taken",
    text: "Someone else booked it for those dates a moment ago. Nothing has been charged. Choose another room or other dates.",
  },
  holds: {
    title: "You already have rooms held",
    text: "Finish paying for the bookings you have started, or wait a few minutes for them to lapse, then try again.",
  },
  details: {
    title: "Please check your details",
    text: "We need your name and a Kenyan mobile number, such as 0712 345 678. If you give an email address, check it is complete.",
  },
  unknown: {
    title: "That did not go through",
    text: "Nothing has been booked or charged. Please try again.",
  },
};

export default async function BookPage({ searchParams }: PageProps<"/book">) {
  await connection();

  const params = await searchParams;
  const query = readStayQuery(params);
  const lodge = await catalogue();
  const now = clock.now();
  const party = { adults: query.adults, children: query.children };
  const roomType = query.room ? roomTypeBySlug(lodge, query.room) : undefined;
  const problemCode = typeof params.problem === "string" ? params.problem : undefined;
  const problem = problemCode ? (problems[problemCode] ?? problems.unknown) : undefined;

  // Anything wrong with the request itself sends the guest back to choose again.
  const requestProblem = !roomType
    ? "Choose a room first."
    : !hasDates(query)
      ? "Choose your dates first."
      : (checkDates(lodge, query, now)?.message ??
        checkParty(lodge, party)?.message ??
        (fits(roomType, party)
          ? null
          : `${theRoom(roomType.name)} sleeps ${roomType.sleeps}. Choose a larger room for your party.`));

  if (requestProblem || !roomType || !hasDates(query)) {
    return (
      <>
        <SiteHeader />
        <main id="main" className="flex-1">
          <div className="wrap py-20">
            <h1 className="display text-5xl">Let us start again</h1>
            <p className="mt-4 max-w-xl text-lg text-ink-soft">{requestProblem}</p>
            <a href="/stay" className="button button-night mt-8">
              Check dates
            </a>
          </div>
        </main>
      </>
    );
  }

  const stay = { from: query.from, to: query.to };
  const nights = nightsIn(stay);
  const free = (await freeCountByType(stay, now)).get(roomType.id) ?? 0;
  const backToSearch = stayAddress("/stay", stay, party);

  const startingPlan = defaultMealPlan(lodge);
  const base = quote(lodge, { roomType, stay, party, mealPlan: startingPlan });
  const terms = termsFor(lodge.settings, stay, base.totalCents, lodgeDay(now));

  const givenPlan = typeof params.meals === "string" && lodge.mealPlans.some((plan) => plan.code === params.meals);
  const givenExtras = (Array.isArray(params.extra) ? params.extra : params.extra ? [params.extra] : [])
    .map(Number)
    .filter((id) => lodge.extras.some((extra) => extra.id === id));

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="wrap py-10 md:py-14">
          <nav aria-label="You are here" className="label text-ink-faint">
            <a href={backToSearch} className="underline-offset-4 hover:text-ink hover:underline">
              Rooms for your dates
            </a>
            <span aria-hidden="true" className="mx-2">
              /
            </span>
            <span aria-current="page">Your details</span>
          </nav>

          <h1 className="display mt-4 text-5xl md:text-6xl">Book {theRoom(roomType.name)}</h1>
          <p className="mt-3 text-lg text-ink-soft">
            {formatStay(stay)} · {plural(nights, "night")} · {plural(party.adults, "adult")}
            {party.children ? `, ${plural(party.children, "child", "children")}` : ""}{" "}
            <a href={backToSearch} className="link ml-1 whitespace-nowrap text-base">
              Change
            </a>
          </p>

          {problem ? (
            <div role="alert" className="mt-8 rounded-2xl border border-heath-600/30 bg-heath-100 p-6">
              <h2 className="display text-2xl text-heath-700">{problem.title}</h2>
              <p className="mt-2">{problem.text}</p>
              {problemCode === "full" ? (
                <a href={backToSearch} className="button button-night mt-4">
                  See what is free
                </a>
              ) : null}
            </div>
          ) : null}

          {free === 0 ? (
            <div role="alert" className="mt-8 rounded-2xl bg-mist-100 p-6">
              <h2 className="display text-2xl">{theRoom(roomType.name)} is no longer free for those dates</h2>
              <p className="mt-2 text-ink-soft">
                It was taken while you were choosing. Other rooms or dates may be free.
              </p>
              <a href={backToSearch} className="button button-night mt-4">
                See what is free
              </a>
            </div>
          ) : (
            <form action="/book/hold" method="post" className="mt-10">
              <input type="hidden" name="room" value={roomType.slug} />
              <input type="hidden" name="in" value={stay.from} />
              <input type="hidden" name="out" value={stay.to} />
              <input type="hidden" name="adults" value={party.adults} />
              <input type="hidden" name="children" value={party.children} />
              {/* The same key goes in however many times this form is sent, so it can only make one booking. */}
              <input type="hidden" name="key" value={randomUUID()} />

              <BookingChoices
                roomName={roomType.name}
                nights={base.nights}
                plans={lodge.mealPlans.map((plan) => ({
                  code: plan.code,
                  name: plan.name,
                  description:
                    plan.adultCents === 0
                      ? plan.description
                      : `${plan.description} For ${plural(party.adults + party.children, "guest")}, ${plural(nights, "night")}.`,
                  cents: mealCharges(plan, party, nights).reduce((sum, charge) => sum + charge.cents, 0),
                }))}
                extras={lodge.extras.map((extra) => ({
                  id: extra.id,
                  name: extra.name,
                  duration: extra.duration,
                  cents: extraCharge(extra, party).cents,
                  note:
                    extra.charged === "per_person"
                      ? `for ${plural(party.adults + party.children, "guest")}`
                      : "for your booking",
                }))}
                initialPlan={givenPlan ? (params.meals as string) : startingPlan}
                initialExtras={givenExtras}
                depositPercent={terms.deposit_percent}
                balanceDue={terms.balance_due ? formatDay(terms.balance_due) : null}
                cancellation={cancellationLines(terms, lodgeDay(now))}
                holdMinutes={lodge.settings.holdMinutes}
              >
                <fieldset>
                  <legend className="display text-3xl">Your details</legend>
                  <p className="mt-1 text-ink-soft">For the person the booking is for.</p>

                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="book-name" className="field-label">
                        Full name
                      </label>
                      <input
                        id="book-name"
                        name="name"
                        type="text"
                        required
                        minLength={2}
                        maxLength={80}
                        autoComplete="name"
                        className="field"
                      />
                    </div>
                    <div>
                      <label htmlFor="book-phone" className="field-label">
                        Mobile number
                      </label>
                      <input
                        id="book-phone"
                        name="phone"
                        type="tel"
                        required
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="0712 345 678"
                        pattern="^\s*(\+?254|0)?[\s\-]?[17](\s?\-?\d){8}\s*$"
                        title="A Kenyan mobile number, such as 0712 345 678"
                        aria-describedby="book-phone-help"
                        className="field tabular"
                      />
                      <p id="book-phone-help" className="mt-1.5 text-sm text-ink-faint">
                        A Kenyan mobile number. We use it if we need to reach you about your stay.
                      </p>
                    </div>
                    <div>
                      <label htmlFor="book-email" className="field-label">
                        Email
                      </label>
                      <input
                        id="book-email"
                        name="email"
                        type="email"
                        maxLength={120}
                        autoComplete="email"
                        aria-describedby="book-email-help"
                        className="field"
                      />
                      <p id="book-email-help" className="mt-1.5 text-sm text-ink-faint">
                        Your confirmation and the link to manage your booking are sent here.
                      </p>
                    </div>
                    <div>
                      <label htmlFor="book-arrival" className="field-label">
                        When will you arrive?
                      </label>
                      <select id="book-arrival" name="arrival" defaultValue="" className="field">
                        <option value="">Not sure yet</option>
                        <option>Before 2 pm</option>
                        <option>2 pm to 5 pm</option>
                        <option>5 pm to 8 pm</option>
                        <option>After 8 pm</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="book-requests" className="field-label">
                        Anything we should know?{" "}
                        <span className="font-normal normal-case tracking-normal">Optional</span>
                      </label>
                      <textarea
                        id="book-requests"
                        name="requests"
                        rows={3}
                        maxLength={1000}
                        placeholder="Diets, a birthday, a cot for the baby"
                        className="field"
                      />
                    </div>
                  </div>
                </fieldset>

                <div className="flex flex-col gap-4 border-t border-rule pt-8 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-md text-sm text-ink-faint">
                    By continuing you accept the{" "}
                    <a href="/booking-terms" className="link">
                      booking and cancellation terms
                    </a>
                    . Nothing is charged until you approve the payment on your phone.
                  </p>
                  <button type="submit" className="button button-ember shrink-0 px-8">
                    Continue to payment
                  </button>
                </div>
              </BookingChoices>
            </form>
          )}
        </div>
      </main>
    </>
  );
}
