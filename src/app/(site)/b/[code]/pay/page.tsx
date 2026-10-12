import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { Bill } from "@/components/site/booking-parts";
import { HoldCountdown, PaymentWatcher } from "@/components/site/live";
import { SiteHeader } from "@/components/site/site-header";
import { formatDay, formatMoney, formatPhone, formatStay, formatTime, maskPhone, plural } from "@/lib/format";
import { privatePage } from "@/lib/metadata";
import { bookingPath } from "@/server/booking/links";
import { bookingForLink, viewOf } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { env } from "@/server/env";
import { readFlash } from "@/server/flash";
import { failureMessage, MPESA_LIMIT_CENTS } from "@/server/payments/daraja";

export const metadata: Metadata = privatePage("Pay for your booking");

export default async function PayPage({ params, searchParams }: PageProps<"/b/[code]/pay">) {
  await connection();
  const { code } = await params;
  const query = await searchParams;

  const booking = await bookingForLink(code);
  if (!booking) notFound();

  const now = clock.now();
  const view = await viewOf(booking, now);
  const { due, money } = view;
  const home = bookingPath(booking);

  // The payment this visit is about, when the guest has just sent a prompt.
  const paymentId = typeof query.p === "string" && /^\d+$/.test(query.p) ? Number(query.p) : null;
  const payment = paymentId ? view.payments.find((entry) => entry.id === paymentId) : undefined;

  if (payment?.status === "paid") {
    redirect(`${home}?paid=${payment.id}`);
  }

  const confirming = booking.status === "held" || booking.status === "provisional";
  const holdGone = booking.status === "held" && view.holdSeconds === 0;
  const payable =
    !holdGone && due.fullCents > 0 && (confirming || booking.status === "confirmed" || booking.status === "checked_in");

  if (!payable && payment?.status !== "pending") {
    // Nothing to pay here: paid in full, over, or the hold ran out. The booking page explains which.
    redirect(home);
  }

  const problem = readFlash(query.note);
  const testSystem = env.mpesaPromptShillings;
  const promptWord = (cents: number) =>
    testSystem ? `${formatMoney(testSystem * 100)} (not ${formatMoney(cents)})` : formatMoney(cents);

  const least = Math.min(due.minimumCents, MPESA_LIMIT_CENTS);
  const most = Math.min(due.fullCents, MPESA_LIMIT_CENTS);
  const overLimit = due.fullCents > MPESA_LIMIT_CENTS;

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="wrap py-10 md:py-14">
          <nav aria-label="You are here" className="label text-ink-faint">
            <Link href={home} className="underline-offset-4 hover:text-ink hover:underline">
              Booking {booking.reference}
            </Link>
            <span aria-hidden="true" className="mx-2">
              /
            </span>
            <span aria-current="page">Pay</span>
          </nav>

          <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-14">
            <div>
              {payment?.status === "pending" ? (
                <section aria-labelledby="waiting-heading">
                  {/* Without script, the browser asks again every five seconds. */}
                  <noscript>
                    <meta httpEquiv="refresh" content="5" />
                  </noscript>
                  <h1 id="waiting-heading" className="display text-5xl md:text-6xl">
                    Check your phone
                  </h1>
                  <div className="mt-6 flex items-start gap-5 rounded-2xl bg-mist-100 p-6">
                    <span
                      aria-hidden="true"
                      className="mt-1 size-9 shrink-0 animate-spin rounded-full border-[3px] border-mist-300 border-t-ember-600"
                    />
                    <div>
                      <p className="text-lg">
                        We have sent an M-Pesa prompt to{" "}
                        <span className="tabular font-semibold">
                          {payment.phone ? maskPhone(payment.phone) : "your phone"}
                        </span>
                        . Enter your PIN to pay <span className="font-semibold">{promptWord(payment.cents)}</span>.
                      </p>
                      <PaymentWatcher
                        statusUrl={`${bookingPath(booking, "/status")}?p=${payment.id}`}
                        paidUrl={`${home}?paid=${payment.id}`}
                        failedUrl={`${bookingPath(booking, "/pay")}?p=${payment.id}`}
                      />
                    </div>
                  </div>
                  <p className="mt-5 text-ink-soft">
                    No prompt after a minute? Check the phone is on, unlocked and has signal. You can leave this page
                    open.
                  </p>
                </section>
              ) : (
                <>
                  <h1 className="display text-5xl md:text-6xl">
                    {confirming ? "Pay to confirm" : due.overdue ? "Pay the overdue balance" : "Pay the balance"}
                  </h1>
                  <p className="mt-3 text-lg text-ink-soft">
                    {view.roomType.name}, {formatStay(booking.stay)}, {plural(view.nights.length, "night")}.
                  </p>

                  {booking.status === "held" && booking.holdUntil ? (
                    <p className="mt-3 inline-block rounded-full bg-ember-100 px-4 py-1.5 text-ember-800">
                      <HoldCountdown
                        until={booking.holdUntil.toISOString()}
                        label={`Held until ${formatTime(booking.holdUntil)}`}
                      />
                    </p>
                  ) : null}

                  {payment?.status === "failed" ? (
                    <div role="alert" className="mt-7 rounded-2xl border border-heath-600/30 bg-heath-100 p-5">
                      <h2 className="font-semibold text-heath-700">The payment did not go through</h2>
                      <p className="mt-1">{failureMessage(payment.failure)}</p>
                    </div>
                  ) : null}
                  {problem ? (
                    <div role="alert" className="mt-7 rounded-2xl border border-heath-600/30 bg-heath-100 p-5">
                      <p>{problem}</p>
                    </div>
                  ) : null}

                  <form action={bookingPath(booking, "/pay/send")} method="post" className="mt-8 space-y-8">
                    <fieldset>
                      <legend className="field-label">How much?</legend>
                      <div className="mt-2 space-y-3">
                        {confirming && least < most ? (
                          <label className="flex cursor-pointer items-start gap-4 rounded-xl border border-mist-300 bg-white p-4 has-checked:border-night-700 has-checked:bg-mist-100">
                            <input
                              type="radio"
                              name="amount"
                              value="least"
                              defaultChecked
                              className="mt-1 size-5 accent-night-900"
                            />
                            <span className="flex-1">
                              <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                                <span className="font-semibold">
                                  The deposit
                                  {booking.terms.deposit_percent < 100 ? ` (${booking.terms.deposit_percent}%)` : ""}
                                </span>
                                <span className="tabular font-semibold">{formatMoney(least)}</span>
                              </span>
                              <span className="mt-0.5 block text-sm text-ink-faint">
                                {booking.terms.balance_due
                                  ? `The rest, ${formatMoney(due.fullCents - least)}, is due by ${formatDay(booking.terms.balance_due, "long")}.`
                                  : "The rest is due before you arrive."}
                              </span>
                            </span>
                          </label>
                        ) : null}

                        <label className="flex cursor-pointer items-start gap-4 rounded-xl border border-mist-300 bg-white p-4 has-checked:border-night-700 has-checked:bg-mist-100">
                          <input
                            type="radio"
                            name="amount"
                            value="most"
                            defaultChecked={!(confirming && least < most)}
                            className="mt-1 size-5 accent-night-900"
                          />
                          <span className="flex-1">
                            <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                              <span className="font-semibold">
                                {overLimit
                                  ? "As much as M-Pesa allows in one payment"
                                  : confirming
                                    ? "Everything now"
                                    : "The whole balance"}
                              </span>
                              <span className="tabular font-semibold">{formatMoney(most)}</span>
                            </span>
                            <span className="mt-0.5 block text-sm text-ink-faint">
                              {overLimit
                                ? `The rest, ${formatMoney(due.fullCents - most)}, can be paid straight afterwards.`
                                : "Nothing more to pay after this."}
                            </span>
                          </span>
                        </label>

                        {!confirming && most > 100_000 ? (
                          <label className="flex cursor-pointer items-start gap-4 rounded-xl border border-mist-300 bg-white p-4 has-checked:border-night-700 has-checked:bg-mist-100">
                            <input type="radio" name="amount" value="other" className="mt-1 size-5 accent-night-900" />
                            <span className="flex-1">
                              <span className="font-semibold">Part of it</span>
                              <span className="mt-2 flex items-center gap-2">
                                <span className="text-ink-faint">KSh</span>
                                <input
                                  type="number"
                                  name="other"
                                  min={1000}
                                  max={most / 100}
                                  step={1}
                                  inputMode="numeric"
                                  aria-label="Amount to pay now, in shillings"
                                  placeholder={String(Math.min(10_000, Math.floor(most / 200)))}
                                  className="field tabular max-w-40"
                                />
                              </span>
                              <span className="mt-1.5 block text-sm text-ink-faint">
                                From KSh 1,000 up to {formatMoney(most)}. Pay the rest whenever you like before it is
                                due.
                              </span>
                            </span>
                          </label>
                        ) : null}
                      </div>
                    </fieldset>

                    <div>
                      <label htmlFor="pay-phone" className="field-label">
                        Safaricom number to send the prompt to
                      </label>
                      <input
                        id="pay-phone"
                        name="phone"
                        type="tel"
                        required
                        inputMode="tel"
                        autoComplete="tel"
                        defaultValue={booking.sample ? "" : formatPhone(booking.guestPhone)}
                        placeholder="0712 345 678"
                        pattern="^\s*(\+?254|0)?[\s\-]?[17](\s?\-?\d){8}\s*$"
                        title="A Safaricom number, such as 0712 345 678"
                        className="field tabular max-w-xs"
                      />
                    </div>

                    {testSystem ? (
                      <p className="rounded-xl border border-night-900/15 bg-white p-4 text-[0.95rem]">
                        <span className="font-semibold">This payment is a test.</span> The prompt on your phone asks for{" "}
                        <span className="font-semibold">{formatMoney(testSystem * 100)}</span> on Safaricom&apos;s test
                        system, whatever amount is shown here. No room is reserved and nothing is provided in return.
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                      <button type="submit" name="method" value="mpesa" className="button button-ember px-8">
                        Send the M-Pesa prompt
                      </button>
                      {env.testPayments ? (
                        <button type="submit" name="method" value="test" formNoValidate className="link text-[0.95rem]">
                          No Safaricom line? Complete with a test payment
                        </button>
                      ) : null}
                    </div>
                  </form>
                </>
              )}
            </div>

            <aside aria-labelledby="pay-bill-heading">
              <div className="rounded-2xl bg-mist-100 p-6">
                <h2 id="pay-bill-heading" className="display text-3xl">
                  The bill
                </h2>
                <div className="mt-4">
                  <Bill view={view} />
                </div>
                <dl className="mt-5 space-y-2 border-t border-rule pt-4">
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-soft">Paid so far</dt>
                    <dd className="tabular font-medium">{formatMoney(money.paidCents)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-soft">Still to pay</dt>
                    <dd className="tabular font-semibold">{formatMoney(money.owedCents)}</dd>
                  </div>
                </dl>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
