import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { BookingChip } from "@/components/desk/chips";
import { DeskPage, Empty, Panel, StepButton } from "@/components/desk/page";
import { daysBetween, lodgeDay, weekday } from "@/lib/dates";
import { formatDay, formatMoney, formatTime, plural } from "@/lib/format";
import { clock } from "@/server/clock";
import { board, type BoardBooking } from "@/server/desk/board";
import { may } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Today" };

function Guest({ entry }: { entry: BoardBooking }) {
  const { booking } = entry;
  return (
    <div className="min-w-0">
      <Link href={`/desk/bookings/${booking.id}`} className="font-semibold underline-offset-4 hover:underline">
        {booking.guestName}
      </Link>
      <p className="truncate text-sm text-ink-faint">
        {entry.roomName} · {entry.roomTypeName} · {plural(booking.adults + booking.children, "guest")}
      </p>
    </div>
  );
}

function Owed({ cents }: { cents: number }) {
  return cents > 0 ? (
    <span className="tabular text-sm whitespace-nowrap text-ember-800">{formatMoney(cents)} to pay</span>
  ) : (
    <span className="text-sm whitespace-nowrap text-moss-700">Paid in full</span>
  );
}

export default async function TodayPage({ searchParams }: PageProps<"/desk">) {
  await connection();
  const staff = await requireStaff();
  const now = clock.now();
  const today = await board(now);
  const canCheck = may(staff, "bookings.check_in_out");

  const toArrive = today.arrivals.filter((entry) => entry.booking.status !== "checked_in");
  const toLeave = today.departures.filter((entry) => entry.booking.status === "checked_in");
  const busiest = Math.max(1, today.rooms);
  const attention = today.overdue.length + today.lapsingSoon.length + today.refundsOwed.length;

  return (
    <DeskPage
      title="Today"
      summary={
        <>
          {formatDay(today.today, "long")} ·{" "}
          <span className="tabular">
            {today.occupiedTonight} of {today.rooms}
          </span>{" "}
          rooms taken tonight
        </>
      }
      actions={
        may(staff, "bookings.make") ? (
          <Link href="/desk/bookings/new" className="button button-ember">
            New booking
          </Link>
        ) : null
      }
      query={await searchParams}
      wide
    >
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Arriving" count={today.arrivals.length}>
          {today.arrivals.length === 0 ? (
            <Empty>Nobody arrives today.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {today.arrivals.map((entry) => (
                <li
                  key={entry.booking.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                >
                  <Guest entry={entry} />
                  <div className="flex items-center gap-3">
                    {entry.booking.status === "checked_in" ? (
                      <span className="text-sm text-ink-faint">
                        In since {entry.booking.checkedInAt ? formatTime(entry.booking.checkedInAt) : "today"}
                      </span>
                    ) : entry.booking.status === "provisional" ? (
                      <BookingChip status="provisional" />
                    ) : (
                      <>
                        <Owed cents={entry.money.owedCents} />
                        {canCheck ? (
                          <StepButton bookingId={entry.booking.id} action="check_in" back="/desk" label="Check in" />
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {toArrive.length > 0 ? (
            <p className="border-t border-rule px-4 py-2.5 text-sm text-ink-faint sm:px-5">
              {plural(toArrive.length, "party", "parties")} still to arrive.
            </p>
          ) : null}
        </Panel>

        <Panel title="Leaving" count={today.departures.length}>
          {today.departures.length === 0 ? (
            <Empty>Nobody leaves today.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {today.departures.map((entry) => (
                <li
                  key={entry.booking.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                >
                  <Guest entry={entry} />
                  <div className="flex items-center gap-3">
                    {entry.booking.status === "checked_out" ? (
                      <span className="text-sm text-ink-faint">
                        Left at {entry.booking.checkedOutAt ? formatTime(entry.booking.checkedOutAt) : "today"}
                      </span>
                    ) : (
                      <>
                        <Owed cents={entry.money.owedCents} />
                        {canCheck ? (
                          <StepButton bookingId={entry.booking.id} action="check_out" back="/desk" label="Check out" />
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {toLeave.length > 0 ? (
            <p className="border-t border-rule px-4 py-2.5 text-sm text-ink-faint sm:px-5">
              {plural(toLeave.length, "party", "parties")} still to check out.
            </p>
          ) : null}
        </Panel>

        <Panel title="In house" count={today.inHouse.length}>
          {today.inHouse.length === 0 ? (
            <Empty>No guests are staying on tonight.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {today.inHouse.map((entry) => (
                <li
                  key={entry.booking.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                >
                  <Guest entry={entry} />
                  <span className="text-sm whitespace-nowrap text-ink-faint">
                    Leaves {formatDay(entry.booking.stay.to, "compact")} ·{" "}
                    {plural(daysBetween(today.today, entry.booking.stay.to), "night")} more
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="The next fourteen nights" className="mt-5">
        <div className="overflow-x-auto px-4 py-4 sm:px-5">
          <ol className="flex min-w-[36rem] items-end gap-1.5">
            {today.nights.map((night) => {
              const weekend = weekday(night.night) === 5 || weekday(night.night) === 6;
              const used = night.taken + night.blocked;
              return (
                <li key={night.night} className="flex-1 text-center">
                  <p className="tabular text-sm font-semibold">
                    {night.taken}
                    <span className="font-normal text-ink-faint">/{today.rooms}</span>
                  </p>
                  <div
                    className="mt-1 flex h-20 flex-col justify-end overflow-hidden rounded-md bg-mist-100"
                    role="img"
                    aria-label={`${formatDay(night.night, "compact")}: ${night.taken} of ${today.rooms} rooms booked${night.blocked ? `, ${night.blocked} blocked` : ""}`}
                  >
                    {night.blocked > 0 ? (
                      <div className="bg-mist-300" style={{ height: `${(night.blocked / busiest) * 100}%` }} />
                    ) : null}
                    <div
                      className={used >= today.rooms ? "bg-ember-500" : "bg-night-700"}
                      style={{ height: `${(night.taken / busiest) * 100}%` }}
                    />
                  </div>
                  <p className={`label mt-1.5 ${weekend ? "text-ink" : "text-ink-faint"}`}>
                    {formatDay(night.night, "compact").split(" ")[0]}
                  </p>
                  <p className="tabular text-xs text-ink-faint">{Number(night.night.slice(8))}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Needs attention" count={attention}>
          {attention === 0 ? (
            <Empty>Nothing is waiting on you.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {today.overdue.map((entry) => (
                <li
                  key={`o${entry.booking.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/desk/bookings/${entry.booking.id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {entry.booking.guestName}
                    </Link>
                    <p className="text-sm text-ink-faint">
                      Balance overdue
                      {entry.booking.terms.balance_due
                        ? ` since ${formatDay(entry.booking.terms.balance_due, "compact")}`
                        : ""}{" "}
                      · arrives {formatDay(entry.booking.stay.from, "compact")}
                    </p>
                  </div>
                  <span className="tabular font-semibold whitespace-nowrap text-heath-700">
                    {formatMoney(entry.money.owedCents)}
                  </span>
                </li>
              ))}
              {today.lapsingSoon.map((entry) => (
                <li
                  key={`l${entry.booking.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/desk/bookings/${entry.booking.id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {entry.booking.guestName}
                    </Link>
                    <p className="text-sm text-ink-faint">
                      Deposit not yet paid · {entry.roomName}, {formatDay(entry.booking.stay.from, "compact")}
                    </p>
                  </div>
                  <span className="text-sm whitespace-nowrap text-ember-800">
                    Lapses {entry.booking.holdUntil ? formatDay(lodgeDay(entry.booking.holdUntil), "compact") : ""}{" "}
                    {entry.booking.holdUntil ? formatTime(entry.booking.holdUntil) : ""}
                  </span>
                </li>
              ))}
              {today.refundsOwed.map((refund) => (
                <li
                  key={`r${refund.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/desk/bookings/${refund.bookingId}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {refund.guestName}
                    </Link>
                    <p className="text-sm text-ink-faint">Refund to send · {refund.reference}</p>
                  </div>
                  <span className="tabular font-semibold whitespace-nowrap">{formatMoney(refund.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Paying right now" count={today.holds.length}>
          {today.holds.length === 0 ? (
            <Empty>No guest is in the middle of paying.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {today.holds.map((entry) => (
                <li
                  key={entry.booking.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/desk/bookings/${entry.booking.id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {entry.booking.guestName}
                    </Link>
                    <p className="text-sm text-ink-faint">
                      {entry.roomName} · {formatDay(entry.booking.stay.from, "compact")} to{" "}
                      {formatDay(entry.booking.stay.to, "compact")}
                    </p>
                  </div>
                  <span className="text-sm whitespace-nowrap text-ember-800">
                    Held until {entry.booking.holdUntil ? formatTime(entry.booking.holdUntil) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </DeskPage>
  );
}
