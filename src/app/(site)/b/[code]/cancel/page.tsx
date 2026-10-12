import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { SiteHeader } from "@/components/site/site-header";
import { formatMoney, formatStay, plural } from "@/lib/format";
import { privatePage } from "@/lib/metadata";
import { bookingPath } from "@/server/booking/links";
import { previewCancellation } from "@/server/booking/service";
import { bookingForLink, viewOf } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { cancellationLines } from "@/server/messages/templates";

export const metadata: Metadata = privatePage("Cancel your booking");

export default async function CancelPage({ params }: PageProps<"/b/[code]/cancel">) {
  await connection();
  const { code } = await params;
  const booking = await bookingForLink(code);
  if (!booking) notFound();

  const view = await viewOf(booking, clock.now());
  const home = bookingPath(booking);
  const allowed =
    booking.status === "provisional" || (booking.status === "confirmed" && booking.stay.from > view.today);
  if (!allowed) redirect(home);

  const outcome = previewCancellation(booking, view.money, view.today);

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
              <span aria-current="page">Cancel</span>
            </nav>

            <h1 className="display mt-4 text-5xl md:text-6xl">Cancel this booking?</h1>
            <p className="mt-3 text-lg text-ink-soft">
              {view.roomType.name}, {formatStay(booking.stay)}, {plural(view.nights.length, "night")}.
            </p>

            <div className="mt-8 rounded-2xl bg-mist-100 p-6 md:p-8">
              <h2 className="display text-3xl">If you cancel today</h2>
              <dl className="mt-5 border-t border-rule">
                <div className="flex justify-between gap-4 border-b border-rule py-3">
                  <dt className="text-ink-soft">You have paid</dt>
                  <dd className="tabular font-medium">{formatMoney(view.money.heldCents)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-rule py-3">
                  <dt className="text-ink-soft">We keep</dt>
                  <dd className="tabular font-medium">{formatMoney(outcome.keptCents)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="font-semibold">We refund</dt>
                  <dd className="display tabular text-4xl">{formatMoney(outcome.refundCents)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-sm text-ink-faint">
                {outcome.refundCents > 0
                  ? "The refund goes to the M-Pesa number that paid, within 3 working days."
                  : view.money.heldCents > 0
                    ? "Under the terms of this booking, there is no refund at this point."
                    : "Nothing has been paid, so nothing is owed either way."}
              </p>
            </div>

            <p className="mt-6 text-ink-soft">
              <span className="font-medium text-ink">The terms of this booking:</span>{" "}
              {cancellationLines(booking.terms, view.today)}
            </p>

            <form action={bookingPath(booking, "/cancel/confirm")} method="post" className="mt-8 flex flex-wrap gap-3">
              <button type="submit" className="button bg-heath-600 text-white hover:bg-heath-700">
                Yes, cancel the booking
              </button>
              <a href={home} className="button button-line">
                Keep my booking
              </a>
            </form>
            <p className="mt-4 text-sm text-ink-faint">
              The room goes back on sale at once, and this cannot be undone.
              {booking.terms.change_until && view.today <= booking.terms.change_until ? (
                <>
                  {" "}
                  You could{" "}
                  <a href={bookingPath(booking, "/change")} className="link">
                    move your stay to other dates
                  </a>{" "}
                  instead.
                </>
              ) : null}
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
