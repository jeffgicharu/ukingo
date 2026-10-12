import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { Bill, Payments, StayFacts } from "@/components/site/booking-parts";
import { HoldCountdown } from "@/components/site/live";
import { SiteHeader } from "@/components/site/site-header";
import { formatDay, formatMoment, formatMoney, formatTime } from "@/lib/format";
import { privatePage } from "@/lib/metadata";
import { bookingPath } from "@/server/booking/links";
import { checkDates, mayChangeDates } from "@/server/booking/rules";
import { bookingForLink, viewOf, type BookingView } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { readFlash } from "@/server/flash";
import { catalogue } from "@/server/lodge/catalogue";
import { cancellationLines } from "@/server/messages/templates";

export const metadata: Metadata = privatePage("Your booking");

type Banner = { tone: "good" | "wait" | "over"; label: string; title: string; text: string };

function bannerFor(view: BookingView, justPaid: boolean): Banner {
  const { booking, money, due } = view;
  switch (booking.status) {
    case "held":
      return {
        tone: "wait",
        label: "Not yet confirmed",
        title: "Pay to confirm your booking",
        text: `The room is being held for you. Pay ${formatMoney(due.minimumCents)} by M-Pesa to confirm it.`,
      };
    case "provisional":
      return {
        tone: "wait",
        label: "Waiting for your deposit",
        title: "We are holding this room for you",
        text: `Pay ${formatMoney(due.minimumCents)} by ${booking.holdUntil ? formatMoment(booking.holdUntil) : "the deadline"} to confirm it. After that the room goes back on sale.`,
      };
    case "confirmed":
      if (justPaid && money.owedCents === 0) {
        return {
          tone: "good",
          label: "Confirmed",
          title: "Thank you. Your stay is paid in full.",
          text: "There is nothing more to pay. We look forward to seeing you.",
        };
      }
      if (justPaid) {
        return {
          tone: "good",
          label: "Confirmed",
          title: "Thank you. Your stay is confirmed.",
          text: `We have your payment. ${formatMoney(money.owedCents)} is still to pay${booking.terms.balance_due ? `, by ${formatDay(booking.terms.balance_due, "long")}` : ""}.`,
        };
      }
      if (due.overdue) {
        return {
          tone: "wait",
          label: "Balance overdue",
          title: `${formatMoney(money.owedCents)} is overdue`,
          text: `The balance was due${booking.terms.balance_due ? ` on ${formatDay(booking.terms.balance_due, "long")}` : ""}. Please pay it now to keep your booking.`,
        };
      }
      return money.owedCents > 0
        ? {
            tone: "good",
            label: "Confirmed",
            title: "Your stay is confirmed",
            text: `${formatMoney(money.owedCents)} is still to pay${booking.terms.balance_due ? `, by ${formatDay(booking.terms.balance_due, "long")}` : ""}. You can pay it in one go or in parts.`,
          }
        : {
            tone: "good",
            label: "Confirmed and paid",
            title: "Your stay is confirmed",
            text: "It is paid in full. We look forward to seeing you.",
          };
    case "checked_in":
      return {
        tone: "good",
        label: "Checked in",
        title: "Welcome to Ukingo",
        text:
          money.owedCents > 0
            ? `${formatMoney(money.owedCents)} is still to pay. You can pay here or at the desk.`
            : "Your stay is paid in full.",
      };
    case "checked_out":
      return {
        tone: "over",
        label: "Stay complete",
        title: "Thank you for staying with us",
        text: "We hope to see you on the edge again.",
      };
    case "cancelled": {
      const owed = view.refunds
        .filter((refund) => refund.status === "owed")
        .reduce((sum, refund) => sum + refund.cents, 0);
      const sent = view.refunds
        .filter((refund) => refund.status === "sent")
        .reduce((sum, refund) => sum + refund.cents, 0);
      return {
        tone: "over",
        label: "Cancelled",
        title: "This booking is cancelled",
        text:
          owed > 0
            ? `${formatMoney(owed)} will be refunded to the M-Pesa number that paid, within 3 working days.`
            : sent > 0
              ? `Your refund of ${formatMoney(sent)} has been sent.`
              : money.paidCents > 0
                ? "Under the terms of the booking, there is no refund."
                : "Nothing was paid, so nothing is owed either way.",
      };
    }
    case "expired":
      return {
        tone: "over",
        label: "Not confirmed",
        title: "This booking was not paid for in time",
        text:
          view.refunds.length > 0
            ? "A payment arrived after the room had been taken by another guest. It will be refunded in full."
            : "The room went back on sale and nothing is owed.",
      };
    case "no_show":
      return {
        tone: "over",
        label: "No-show",
        title: "We did not see you",
        text: "This stay was not taken up. Under the terms of the booking, there is no refund.",
      };
  }
}

export default async function BookingPage({ params, searchParams }: PageProps<"/b/[code]">) {
  await connection();
  const { code } = await params;
  const query = await searchParams;

  const booking = await bookingForLink(code);
  if (!booking) notFound();

  const now = clock.now();
  const [view, lodge] = [await viewOf(booking, now), await catalogue()];
  const justPaid = typeof query.paid === "string";
  const note = readFlash(query.note);
  const banner = bannerFor(view, justPaid);

  const live = booking.status === "confirmed" || booking.status === "checked_in";
  const canPay =
    (booking.status === "held" && view.holdSeconds > 0) ||
    booking.status === "provisional" ||
    (live && view.money.owedCents > 0);
  const canChange = booking.status === "confirmed" && mayChangeDates(booking.terms, view.today);
  const canCancel =
    booking.status === "provisional" || (booking.status === "confirmed" && booking.stay.from > view.today);
  // A hold that ran out can be taken up again while the dates can still be booked.
  const canHoldAgain =
    booking.source === "website" &&
    (booking.status === "expired" || (booking.status === "held" && view.holdSeconds === 0)) &&
    view.refunds.length === 0 &&
    checkDates(lodge, booking.stay, now) === null;

  const tones = {
    good: "bg-moss-100 text-moss-700",
    wait: "bg-ember-100 text-ember-800",
    over: "bg-mist-200 text-ink-soft",
  };

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="contours bg-night-900 text-mist-50">
          <div className="wrap py-12 md:py-16">
            <p className="flex flex-wrap items-center gap-3">
              <span className={`label rounded-full px-3 py-1.5 ${tones[banner.tone]}`}>{banner.label}</span>
              <span className="label text-night-300">Booking {booking.reference}</span>
            </p>
            <h1 className="display mt-5 max-w-[20ch] text-4xl md:text-6xl">
              {booking.status === "held" && view.holdSeconds === 0 ? "The time to pay ran out" : banner.title}
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-night-200">
              {booking.status === "held" && view.holdSeconds === 0
                ? "The room is no longer being held. If it is still free you can hold it again at the same price."
                : banner.text}
            </p>

            {booking.status === "held" && view.holdSeconds > 0 && booking.holdUntil ? (
              <p className="mt-3 text-ember-300">
                <HoldCountdown
                  until={booking.holdUntil.toISOString()}
                  label={`Held until ${formatTime(booking.holdUntil)}`}
                />
              </p>
            ) : null}

            <div className="mt-7 flex flex-wrap gap-3">
              {canPay ? (
                <Link href={bookingPath(booking, "/pay")} className="button button-ember">
                  {booking.status === "held" || booking.status === "provisional"
                    ? "Pay and confirm"
                    : "Pay the balance"}
                </Link>
              ) : null}
              {canHoldAgain ? (
                <form action={bookingPath(booking, "/hold")} method="post">
                  <button type="submit" className="button button-ember">
                    Hold the room again
                  </button>
                </form>
              ) : null}
              {live || booking.status === "checked_out" ? (
                <a href={bookingPath(booking, "/calendar")} className="button button-line-light">
                  Add to my calendar
                </a>
              ) : null}
              {booking.status === "expired" || booking.status === "cancelled" ? (
                <Link href="/stay" className="button button-line-light">
                  Check other dates
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="wrap py-12 md:py-16">
          {note ? (
            <p role="status" className="mb-10 rounded-xl border border-moss-600/30 bg-moss-100 px-5 py-4 text-moss-700">
              {note}
            </p>
          ) : null}

          <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
            <div className="space-y-12">
              <section aria-labelledby="stay-heading">
                <h2 id="stay-heading" className="display text-3xl">
                  Your stay
                </h2>
                <div className="mt-4">
                  <StayFacts
                    view={view}
                    checkInFrom={lodge.settings.checkInFrom}
                    checkOutBy={lodge.settings.checkOutBy}
                  />
                </div>
                {booking.requests ? (
                  <p className="mt-4 text-ink-soft">
                    <span className="font-medium text-ink">You told us:</span> {booking.requests}
                  </p>
                ) : null}
              </section>

              {live || booking.status === "provisional" || booking.status === "held" ? (
                <section aria-labelledby="terms-heading">
                  <h2 id="terms-heading" className="display text-3xl">
                    Changing or cancelling
                  </h2>
                  <p className="mt-4 text-ink-soft">
                    {booking.terms.change_until && view.today <= booking.terms.change_until
                      ? `You can move your stay to other dates until ${formatDay(booking.terms.change_until, "long")}. `
                      : "The dates of this booking can no longer be changed online. "}
                    {cancellationLines(booking.terms, view.today)}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    {canChange ? (
                      <Link href={bookingPath(booking, "/change")} className="button button-line">
                        Change dates
                      </Link>
                    ) : null}
                    {canCancel ? (
                      <Link href={bookingPath(booking, "/cancel")} className="button button-line">
                        Cancel booking
                      </Link>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {live ? (
                <section aria-labelledby="directions-heading">
                  <h2 id="directions-heading" className="display text-3xl">
                    Getting here
                  </h2>
                  <p className="mt-4 text-ink-soft">
                    Ukingo is 14 km from Nanyuki, on the Mount Kenya side. The last 4 km are a murram road that any car
                    manages in dry weather. Please arrive before dark: the gate closes at 9 pm.
                  </p>
                  <Link href="/getting-here" className="link mt-3 inline-block">
                    Directions and the map pin
                  </Link>
                </section>
              ) : null}
            </div>

            <div className="space-y-12">
              <section aria-labelledby="bill-heading" className="rounded-2xl bg-mist-100 p-6 md:p-7">
                <h2 id="bill-heading" className="display text-3xl">
                  The bill
                </h2>
                <div className="mt-4">
                  <Bill view={view} />
                </div>
                <dl className="mt-5 space-y-2 border-t border-rule pt-4">
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-soft">Paid</dt>
                    <dd className="tabular font-medium">{formatMoney(view.money.paidCents)}</dd>
                  </div>
                  {view.money.refundOwedCents + view.money.refundSentCents > 0 ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-soft">Refunded</dt>
                      <dd className="tabular font-medium">
                        {formatMoney(view.money.refundOwedCents + view.money.refundSentCents)}
                      </dd>
                    </div>
                  ) : null}
                  {view.money.owedCents > 0 ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-soft">
                        Still to pay
                        {live && booking.terms.balance_due ? `, by ${formatDay(booking.terms.balance_due)}` : ""}
                      </dt>
                      <dd className="tabular font-semibold">{formatMoney(view.money.owedCents)}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              {view.payments.some((payment) => payment.status === "paid") || view.refunds.length ? (
                <section aria-labelledby="payments-heading">
                  <h2 id="payments-heading" className="display text-3xl">
                    Payments
                  </h2>
                  <div className="mt-4">
                    <Payments view={view} />
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
