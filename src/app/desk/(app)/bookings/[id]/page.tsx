import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { BookingChip } from "@/components/desk/chips";
import { DeskPage, Panel, StepButton } from "@/components/desk/page";
import { methodName } from "@/components/site/booking-parts";
import { formatDay, formatMoment, formatMoney, formatStay, formatTime, plural } from "@/lib/format";
import { isOver } from "@/server/booking/ledger";
import { refundOnCancel } from "@/server/booking/rules";
import { viewOf } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { bookingById, emailFor, historyOf, nameFor, phoneFor } from "@/server/desk/bookings";
import { catalogue } from "@/server/lodge/catalogue";
import { cancellationLines, messageName } from "@/server/messages/templates";
import { failureMessage } from "@/server/payments/daraja";
import { may } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Booking" };

const field = "field min-h-10 py-2";
const smallButton = "button min-h-10 px-4 py-2 text-sm";

export default async function BookingPage({ params, searchParams }: PageProps<"/desk/bookings/[id]">) {
  await connection();
  const staff = await requireStaff("bookings.view");
  const { id } = await params;
  const booking = await bookingById(Number(id));
  if (!booking) notFound();

  const now = clock.now();
  const [view, lodge, history] = [await viewOf(booking, now), await catalogue(), await historyOf(booking.id)];
  const { money, due, today } = view;
  const back = `/desk/bookings/${booking.id}`;
  const act = `/desk/bookings/${booking.id}/act`;

  const over = isOver(booking.status);
  const inHouse = booking.status === "checked_in";
  const holdsRoom = !over && booking.status !== "checked_out";
  const canTakeMoney = may(staff, "payments.take") && !over && money.owedCents > 0;
  const canChange = may(staff, "bookings.change") && holdsRoom;
  const canCancel = may(staff, "bookings.cancel") && ["held", "provisional", "confirmed"].includes(booking.status);
  const canCheck = may(staff, "bookings.check_in_out");
  const subject = {
    name: booking.guestName,
    phone: booking.guestPhone,
    email: booking.guestEmail,
    sample: booking.sample,
  };
  const byTerms = refundOnCancel(booking.terms, booking.totalCents, money.heldCents, today);
  const otherRooms = lodge.roomTypes.flatMap((type) =>
    type.rooms
      .filter((room) => room.id !== booking.roomId && type.sleeps >= booking.adults + booking.children)
      .map((room) => ({ ...room, typeName: type.name })),
  );
  const refundsOwed = view.refunds.filter((refund) => refund.status === "owed");
  const pending = view.payments.find((payment) => payment.status === "pending");
  const lastFailed = [...view.payments].reverse().find((payment) => payment.status === "failed");

  return (
    <DeskPage
      title={nameFor(staff, subject)}
      summary={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tabular">{booking.reference}</span>
          <BookingChip status={booking.status} money={money} />
          <span>
            {view.room.name} · {view.roomType.name}
          </span>
        </span>
      }
      actions={
        <>
          {canCheck && booking.status === "confirmed" && today >= booking.stay.from && today < booking.stay.to ? (
            <StepButton bookingId={booking.id} action="check_in" back={back} label="Check in" tone="ember" />
          ) : null}
          {canCheck && booking.status === "checked_in" ? (
            <StepButton bookingId={booking.id} action="check_out" back={back} label="Check out" tone="ember" />
          ) : null}
          {canCheck && booking.status === "confirmed" && today > booking.stay.from ? (
            <StepButton bookingId={booking.id} action="no_show" back={back} label="Mark as no-show" tone="line" />
          ) : null}
          <a href="/desk/bookings" className={`${smallButton} button-line`}>
            All bookings
          </a>
        </>
      }
      query={await searchParams}
    >
      {booking.status === "held" || booking.status === "provisional" ? (
        <p className="mb-5 rounded-xl border border-ember-600/30 bg-ember-100 px-4 py-3 text-ember-800">
          {booking.status === "held"
            ? `The guest is paying now. The room is held until ${booking.holdUntil ? formatTime(booking.holdUntil) : "shortly"}.`
            : `Waiting for a deposit of ${formatMoney(due.minimumCents)}. The room is let go on ${booking.holdUntil ? formatMoment(booking.holdUntil) : "the deadline"} if it has not come.`}
        </p>
      ) : null}
      {pending ? (
        <p className="mb-5 rounded-xl border border-ember-600/30 bg-ember-100 px-4 py-3 text-ember-800">
          An M-Pesa prompt for {formatMoney(pending.cents)} is on the guest&apos;s phone, sent at{" "}
          {formatTime(pending.requestedAt)}. This page updates when it is answered.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          <Panel title="Stay">
            <dl className="divide-y divide-rule">
              {(
                [
                  ["Dates", `${formatStay(booking.stay)} · ${plural(view.nights.length, "night")}`],
                  ["Room", `${view.room.name}, ${view.roomType.name}`],
                  [
                    "Guests",
                    `${plural(booking.adults, "adult")}${booking.children ? `, ${plural(booking.children, "child", "children")}` : ""}`,
                  ],
                  ["Meals", view.mealPlan.name],
                  ["Arriving", booking.arrivalTime || "Not said"],
                  ["Requests", booking.requests || "None"],
                  [
                    "Booked",
                    `${formatMoment(booking.createdAt)}, ${booking.source === "website" ? "on the website" : "at the desk"}`,
                  ],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="grid grid-cols-[6.5rem_1fr] gap-3 px-4 py-2.5 sm:px-5">
                  <dt className="label pt-1 text-ink-faint">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            </dl>

            {canChange ? (
              <div className="divide-y divide-rule border-t border-rule">
                <form action={act} method="post" className="space-y-2 px-4 py-4 sm:px-5">
                  <input type="hidden" name="action" value="change_dates" />
                  <input type="hidden" name="back" value={back} />
                  <p className="font-semibold">Change dates</p>
                  <div className="grid max-w-md grid-cols-2 gap-2">
                    <label className="block">
                      <span className="field-label">Arrive</span>
                      <input
                        type="date"
                        name="in"
                        required
                        defaultValue={booking.stay.from}
                        className={`${field} tabular`}
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Leave</span>
                      <input
                        type="date"
                        name="out"
                        required
                        defaultValue={booking.stay.to}
                        className={`${field} tabular`}
                      />
                    </label>
                  </div>
                  <button type="submit" className={`${smallButton} button-line`}>
                    Move the stay
                  </button>
                  <p className="text-sm text-ink-faint">Charged at the prices of the new dates. The guest is told.</p>
                </form>

                <form action={act} method="post" className="space-y-2 px-4 py-4 sm:px-5">
                  <input type="hidden" name="action" value="move_room" />
                  <input type="hidden" name="back" value={back} />
                  <p className="font-semibold">Move to another room</p>
                  <label className="block">
                    <span className="field-label">Room</span>
                    <select name="room" required defaultValue="" className={field}>
                      <option value="" disabled>
                        Choose a room
                      </option>
                      {otherRooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name} ({room.typeName})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={`${smallButton} button-line`}>
                    Move
                  </button>
                  <p className="text-sm text-ink-faint">The price stays as it is. Refused if the room is taken.</p>
                </form>
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Guest"
            action={
              <a href={`/desk/guests/${booking.guestId}`} className="link text-sm">
                All their stays
              </a>
            }
          >
            <dl className="divide-y divide-rule">
              <div className="grid grid-cols-[6.5rem_1fr] gap-3 px-4 py-2.5 sm:px-5">
                <dt className="label pt-1 text-ink-faint">Name</dt>
                <dd>{nameFor(staff, subject)}</dd>
              </div>
              <div className="grid grid-cols-[6.5rem_1fr] gap-3 px-4 py-2.5 sm:px-5">
                <dt className="label pt-1 text-ink-faint">Phone</dt>
                <dd className="amount">{phoneFor(staff, subject)}</dd>
              </div>
              <div className="grid grid-cols-[6.5rem_1fr] gap-3 px-4 py-2.5 sm:px-5">
                <dt className="label pt-1 text-ink-faint">Email</dt>
                <dd className="min-w-0 break-words">{emailFor(staff, subject) ?? "None given"}</dd>
              </div>
            </dl>
            {staff.training && !booking.sample ? (
              <p className="border-t border-rule px-4 py-2.5 text-sm text-ink-faint sm:px-5">
                Training accounts see part of a real guest&apos;s details only.
              </p>
            ) : null}
          </Panel>

          <Panel title="Notes" count={history.notes.length}>
            {history.notes.length ? (
              <ul className="divide-y divide-rule">
                {history.notes.map((note) => (
                  <li key={note.id} className="px-4 py-3 sm:px-5">
                    <p className="whitespace-pre-wrap">{note.body}</p>
                    <p className="mt-1 text-sm text-ink-faint">
                      {note.staffName}, {formatMoment(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            {may(staff, "bookings.change") ? (
              <form
                action={act}
                method="post"
                className={`space-y-2 px-4 py-4 sm:px-5 ${history.notes.length ? "border-t border-rule" : ""}`}
              >
                <input type="hidden" name="action" value="note" />
                <input type="hidden" name="back" value={back} />
                <label className="block">
                  <span className="field-label">Add a note for the team</span>
                  <textarea name="body" rows={2} required maxLength={2000} className="field" />
                </label>
                <button type="submit" className={`${smallButton} button-line`}>
                  Save note
                </button>
              </form>
            ) : null}
          </Panel>

          <Panel title="History">
            <ol className="divide-y divide-rule">
              {history.events.map((event) => (
                <li key={event.id} className="px-4 py-3 sm:px-5">
                  <p>{event.summary}</p>
                  <p className="mt-0.5 text-sm text-ink-faint">
                    {formatMoment(event.at)} ·{" "}
                    {event.actor === "staff"
                      ? (event.staffName ?? "Staff")
                      : event.actor === "guest"
                        ? "The guest"
                        : "The system"}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Bill">
            <table className="tabular w-full text-[0.95rem]">
              <tbody className="divide-y divide-rule">
                {view.nights.map((night) => (
                  <tr key={night.night}>
                    <th scope="row" className="px-4 py-2 text-left font-normal sm:px-5">
                      {formatDay(night.night, "compact")}
                    </th>
                    <td className="px-4 py-2 text-right whitespace-nowrap sm:px-5">{formatMoney(night.cents)}</td>
                  </tr>
                ))}
                {view.charges.map((charge) => (
                  <tr key={charge.id}>
                    <th scope="row" className="px-4 py-2 text-left font-normal sm:px-5">
                      {charge.label}
                      {canChange &&
                      charge.kind !== "meals" &&
                      (charge.kind === "extra" || may(staff, "bill.adjust")) ? (
                        <form action={act} method="post" className="inline">
                          <input type="hidden" name="action" value="remove_charge" />
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="charge" value={charge.id} />
                          <button type="submit" className="link ml-2 text-sm" aria-label={`Remove ${charge.label}`}>
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </th>
                    <td className="px-4 py-2 text-right whitespace-nowrap sm:px-5">{formatMoney(charge.cents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-rule">
                  <th scope="row" className="px-4 py-3 text-left sm:px-5">
                    Total
                  </th>
                  <td className="display px-4 py-2 text-right text-2xl whitespace-nowrap sm:px-5">
                    {formatMoney(money.totalCents)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {canChange ? (
              <div className="space-y-4 border-t border-rule px-4 py-4 sm:px-5">
                <form action={act} method="post" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="action" value="add_extra" />
                  <input type="hidden" name="back" value={back} />
                  <label className="block min-w-0 flex-1">
                    <span className="field-label">Add an extra</span>
                    <select name="extra" required defaultValue="" className={field}>
                      <option value="" disabled>
                        Choose
                      </option>
                      {lodge.extras.map((extra) => (
                        <option key={extra.id} value={extra.id}>
                          {extra.name}, {formatMoney(extra.priceCents)}{" "}
                          {extra.charged === "per_person" ? "a guest" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={`${smallButton} button-line`}>
                    Add
                  </button>
                </form>

                {may(staff, "bill.adjust") ? (
                  <form action={act} method="post" className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
                    <input type="hidden" name="action" value="add_adjustment" />
                    <input type="hidden" name="back" value={back} />
                    <label className="block min-w-0">
                      <span className="field-label">Other charge or discount</span>
                      <input name="label" required maxLength={120} placeholder="What it is for" className={field} />
                    </label>
                    <label className="block">
                      <span className="field-label">KSh</span>
                      <input
                        name="amount"
                        required
                        inputMode="numeric"
                        pattern="-?[0-9,]+"
                        placeholder="-2500"
                        className={`${field} tabular`}
                      />
                    </label>
                    <button type="submit" className={`${smallButton} button-line`}>
                      Add
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </Panel>

          <Panel title="Money">
            <dl className="divide-y divide-rule">
              <div className="flex justify-between gap-4 px-4 py-2.5 sm:px-5">
                <dt className="text-ink-soft">Paid</dt>
                <dd className="amount font-medium">{formatMoney(money.paidCents)}</dd>
              </div>
              {money.refundOwedCents + money.refundSentCents > 0 ? (
                <div className="flex justify-between gap-4 px-4 py-2.5 sm:px-5">
                  <dt className="text-ink-soft">Refunded or owed back</dt>
                  <dd className="amount font-medium">{formatMoney(money.refundOwedCents + money.refundSentCents)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 px-4 py-2.5 sm:px-5">
                <dt className="text-ink-soft">
                  Still to pay
                  {!over && money.owedCents > 0 && booking.terms.balance_due
                    ? `, by ${formatDay(booking.terms.balance_due)}`
                    : ""}
                </dt>
                <dd className={`amount font-semibold ${due.overdue && !inHouse ? "text-heath-700" : ""}`}>
                  {formatMoney(money.owedCents)}
                  {/* A guest in the house settles up when they leave. Only a bill nobody is here to pay is late. */}
                  {money.owedCents > 0 && inHouse
                    ? ", to settle at check-out"
                    : due.overdue
                      ? booking.status === "checked_out"
                        ? " left owing"
                        : " overdue"
                      : ""}
                </dd>
              </div>
            </dl>

            {canCheck && inHouse && money.owedCents > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-3 sm:px-5">
                <p className="max-w-xs text-sm text-ink-faint">
                  Check-out waits for the bill to be settled. If the guest is leaving without paying:
                </p>
                <StepButton
                  bookingId={booking.id}
                  action="check_out"
                  back={back}
                  label={`Check out, leaving ${formatMoney(money.owedCents)} owing`}
                  tone="line"
                  fields={{ owing: "leave" }}
                />
              </div>
            ) : null}

            {view.payments.length ? (
              <ul className="divide-y divide-rule border-t border-rule">
                {view.payments.map((payment) => (
                  <li key={payment.id} className="grid grid-cols-[1fr_auto] gap-x-3 px-4 py-2.5 text-[0.95rem] sm:px-5">
                    <span>
                      {methodName(payment.method)}
                      {payment.receipt ? <span className="tabular text-ink-faint"> · {payment.receipt}</span> : null}
                    </span>
                    <span
                      className={`tabular text-right ${payment.status === "paid" ? "font-medium" : "text-ink-faint line-through"}`}
                    >
                      {formatMoney(payment.cents)}
                    </span>
                    <span className="col-span-2 text-sm text-ink-faint">
                      {formatMoment(payment.settledAt ?? payment.requestedAt)} ·{" "}
                      {payment.status === "paid"
                        ? "Paid"
                        : payment.status === "pending"
                          ? "Waiting for the guest's PIN"
                          : "Did not go through"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {lastFailed && !pending && canTakeMoney && view.payments[view.payments.length - 1]?.id === lastFailed.id ? (
              <p className="border-t border-rule px-4 py-2.5 text-sm text-heath-700 sm:px-5">
                {failureMessage(lastFailed.failure)}
              </p>
            ) : null}

            {canTakeMoney ? (
              <div className="space-y-5 border-t border-rule px-4 py-4 sm:px-5">
                <form action={act} method="post" className="space-y-2">
                  <input type="hidden" name="action" value="pay_prompt" />
                  <input type="hidden" name="back" value={back} />
                  <p className="font-semibold">Send an M-Pesa prompt</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="field-label">KSh</span>
                      <input
                        name="amount"
                        required
                        inputMode="numeric"
                        defaultValue={
                          Math.max(due.minimumCents, 0) > 0 ? due.minimumCents / 100 : money.owedCents / 100
                        }
                        className={`${field} tabular`}
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Safaricom number</span>
                      <input
                        name="phone"
                        type="tel"
                        required
                        placeholder="0712 345 678"
                        className={`${field} tabular`}
                      />
                    </label>
                  </div>
                  <button type="submit" className={`${smallButton} button-night`}>
                    Send prompt
                  </button>
                </form>

                <form action={act} method="post" className="space-y-2">
                  <input type="hidden" name="action" value="pay_desk" />
                  <input type="hidden" name="back" value={back} />
                  <p className="font-semibold">Record a payment taken here</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="field-label">How</span>
                      <select name="method" defaultValue="cash" className={field}>
                        <option value="cash">Cash</option>
                        <option value="mpesa_desk">M-Pesa to the till</option>
                        <option value="bank">Bank transfer</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">KSh</span>
                      <input
                        name="amount"
                        required
                        inputMode="numeric"
                        defaultValue={money.owedCents / 100}
                        className={`${field} tabular`}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="field-label">
                      Reference <span className="font-normal normal-case tracking-normal">needed unless cash</span>
                    </span>
                    <input name="reference" maxLength={60} className={`${field} tabular`} />
                  </label>
                  <button type="submit" className={`${smallButton} button-line`}>
                    Record payment
                  </button>
                </form>
              </div>
            ) : null}
          </Panel>

          {refundsOwed.length ? (
            <Panel title="Refund to send" count={refundsOwed.length}>
              <ul className="divide-y divide-rule">
                {refundsOwed.map((refund) => (
                  <li key={refund.id} className="space-y-2 px-4 py-3 sm:px-5">
                    <p className="flex justify-between gap-3">
                      <span>{refund.reason}</span>
                      <span className="tabular font-semibold whitespace-nowrap">{formatMoney(refund.cents)}</span>
                    </p>
                    {may(staff, "refunds.send") ? (
                      <form action={act} method="post" className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="action" value="refund_sent" />
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="refund" value={refund.id} />
                        <label className="block min-w-0 flex-1">
                          <span className="field-label">M-Pesa reference of the refund</span>
                          <input name="reference" required maxLength={60} className={`${field} tabular`} />
                        </label>
                        <button type="submit" className={`${smallButton} button-night`}>
                          Record as sent
                        </button>
                      </form>
                    ) : (
                      <p className="text-sm text-ink-faint">A manager records this once the money has been sent.</p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Terms of this booking">
            <div className="space-y-2 px-4 py-3 text-[0.95rem] text-ink-soft sm:px-5">
              <p>
                Deposit {booking.terms.deposit_percent}% ({formatMoney(booking.terms.deposit_cents)}).{" "}
                {booking.terms.balance_due
                  ? `Balance due ${formatDay(booking.terms.balance_due, "long")}.`
                  : "Everything was due at booking."}
              </p>
              <p>
                {booking.terms.change_until
                  ? `The guest can change dates online until ${formatDay(booking.terms.change_until, "long")}.`
                  : "The guest cannot change dates online."}
              </p>
              {/* In the guest's own words, from today on. Steps already past are left out. */}
              <p>{cancellationLines(booking.terms, today)}</p>
            </div>

            {canCancel ? (
              <details className="border-t border-rule">
                <summary className="cursor-pointer px-4 py-3 font-semibold text-heath-700 sm:px-5">
                  Cancel this booking
                </summary>
                <form action={act} method="post" className="space-y-3 px-4 pb-4 sm:px-5">
                  <input type="hidden" name="action" value="cancel" />
                  <input type="hidden" name="back" value={back} />
                  <p className="text-[0.95rem]">
                    Cancelled today, the booking&apos;s terms keep {formatMoney(byTerms.keptCents)} and refund{" "}
                    <span className="font-semibold">{formatMoney(byTerms.refundCents)}</span> of the{" "}
                    {formatMoney(money.heldCents)} paid.
                  </p>
                  <label className="block">
                    <span className="field-label">Reason</span>
                    <input name="reason" maxLength={200} placeholder="Guest phoned to cancel" className={field} />
                  </label>
                  {may(staff, "refunds.override") && money.heldCents > 0 ? (
                    <label className="block">
                      <span className="field-label">
                        Refund a different amount, KSh{" "}
                        <span className="font-normal normal-case tracking-normal">leave empty to follow the terms</span>
                      </span>
                      <input
                        name="refund"
                        inputMode="numeric"
                        pattern="[0-9,]*"
                        className={`${field} tabular max-w-40`}
                      />
                    </label>
                  ) : null}
                  <button type="submit" className={`${smallButton} bg-heath-600 text-white hover:bg-heath-700`}>
                    Cancel the booking
                  </button>
                  <p className="text-sm text-ink-faint">
                    The room goes back on sale at once and the guest is told. This cannot be undone.
                  </p>
                </form>
              </details>
            ) : null}
          </Panel>

          <Panel title="Messages" count={history.messages.length}>
            {history.messages.length ? (
              <ul className="divide-y divide-rule">
                {history.messages.map((message) => (
                  <li key={message.id} className="px-4 py-2.5 sm:px-5">
                    <a href={`/desk/messages/${message.id}`} className="underline-offset-4 hover:underline">
                      {message.channel === "sms" ? "Text: " : ""}
                      {message.subject ?? messageName(message.kind)}
                    </a>
                    <p className="text-sm text-ink-faint">
                      {formatMoment(message.createdAt)} ·{" "}
                      {message.status === "sent"
                        ? "Sent"
                        : message.status === "queued"
                          ? "Waiting to send"
                          : message.status === "failed"
                            ? "Failed"
                            : "Not sent"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-ink-faint sm:px-5">
                Nothing has been written to this guest yet.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </DeskPage>
  );
}
