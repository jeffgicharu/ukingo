import type { Metadata } from "next";
import { connection } from "next/server";

import { BAR_LOOKS, type BarState, type CalendarBar } from "@/components/desk/calendar-bars";
import { CalendarGrid } from "@/components/desk/calendar-grid";
import { DeskPage, Panel } from "@/components/desk/page";
import { type Day, addDays, isDay, lodgeDay, nightsIn } from "@/lib/dates";
import { formatDay, formatStay, plural } from "@/lib/format";
import { clock } from "@/server/clock";
import { nameFor } from "@/server/desk/bookings";
import { calendarWindow, type CalendarEntry } from "@/server/desk/calendar";
import { may, type Staff } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Calendar" };

const SPANS = { weeks: 14, month: 31 } as const;
type Span = keyof typeof SPANS;
type View = "auto" | "grid" | "list";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

function stateOf(entry: CalendarEntry): BarState | null {
  if (entry.bookingId === null) return "block";
  switch (entry.status) {
    case "held":
      return "held";
    case "provisional":
      return "awaiting";
    case "confirmed":
      return entry.paid ? "paid" : "deposit";
    case "checked_in":
      return "in_house";
    case "checked_out":
      return "departed";
    default:
      return null;
  }
}

function barsFor(entries: CalendarEntry[], staff: Staff): CalendarBar[] {
  const canChange = may(staff, "bookings.change");
  return entries.flatMap((entry) => {
    const state = stateOf(entry);
    if (!state) return [];
    const stay = { from: entry.from, to: entry.to };
    const label =
      state === "block"
        ? (entry.blockReason ?? "Off sale")
        : nameFor(staff, { name: entry.guestName ?? "Guest", sample: entry.sample });
    return [
      {
        key: `a${entry.allocationId}`,
        allocationId: entry.allocationId,
        roomId: entry.roomId,
        from: entry.from,
        to: entry.to,
        bookingId: entry.bookingId,
        label,
        detail:
          state === "block"
            ? `Off sale, ${formatStay(stay)}: ${label}`
            : `${BAR_LOOKS[state].name}, ${entry.reference}, ${formatStay(stay)}, ${plural(nightsIn(stay), "night")}, ${plural(entry.guests ?? 0, "guest")}`,
        state,
        move:
          !canChange || state === "block"
            ? "none"
            : state === "awaiting" || state === "deposit" || state === "paid"
              ? "anywhere"
              : state === "in_house"
                ? "room"
                : "none",
      },
    ];
  });
}

export default async function CalendarPage({ searchParams }: PageProps<"/desk/calendar">) {
  await connection();
  const staff = await requireStaff("bookings.view");
  const query = await searchParams;

  const now = clock.now();
  const today = lodgeDay(now);
  const span: Span = one(query.span) === "month" ? "month" : "weeks";
  const asked = one(query.from);
  // Yesterday is kept in view, so this morning's departures can still be seen.
  const from: Day = isDay(asked) ? asked : addDays(today, -1);
  const view: View = one(query.view) === "list" ? "list" : one(query.view) === "grid" ? "grid" : "auto";

  const shown = await calendarWindow(from, SPANS[span], now);
  const bars = barsFor(shown.entries, staff);
  const roomName = new Map(shown.rooms.map((room) => [room.id, room.name]));

  const address = (changes: { from?: Day | null; span?: Span; view?: View }) => {
    const next = { from: isDay(asked) ? asked : null, span, view, ...changes };
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.span !== "weeks") params.set("span", next.span);
    if (next.view !== "auto") params.set("view", next.view);
    const text = params.toString();
    return text ? `/desk/calendar?${text}` : "/desk/calendar";
  };

  const step = "button button-line min-h-10 px-4 py-2 text-sm";
  const choice = (on: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-medium ${on ? "bg-night-900 text-mist-50" : "text-ink-soft hover:text-ink"}`;
  const last = addDays(from, SPANS[span] - 1);

  // On a phone the day-by-day list is the easier read. Either can be asked for by name.
  const gridShown = view === "grid" ? "" : view === "list" ? "hidden" : "hidden md:block";
  const listShown = view === "list" ? "" : view === "grid" ? "hidden" : "md:hidden";

  return (
    <DeskPage
      title="Calendar"
      summary={`${formatDay(from, "compact")} to ${formatDay(last, "short")}`}
      actions={
        may(staff, "bookings.make") ? (
          <a href="/desk/bookings/new" className="button button-ember">
            New booking
          </a>
        ) : null
      }
      query={query}
      wide
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <a href={address({ from: addDays(from, -SPANS[span]) })} className={step}>
            <span aria-hidden="true">←</span> Earlier
          </a>
          <a href={address({ from: null })} className={step}>
            Today
          </a>
          <a href={address({ from: addDays(from, SPANS[span]) })} className={step}>
            Later <span aria-hidden="true">→</span>
          </a>
          <form action="/desk/calendar" method="get" className="flex items-center gap-2">
            {span !== "weeks" ? <input type="hidden" name="span" value={span} /> : null}
            {view !== "auto" ? <input type="hidden" name="view" value={view} /> : null}
            <label htmlFor="calendar-jump" className="sr-only">
              Go to a date
            </label>
            <input
              id="calendar-jump"
              type="date"
              name="from"
              required
              defaultValue={from}
              className="field tabular min-h-10 w-auto py-2"
            />
            <button type="submit" className={step}>
              Go
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center rounded-full border border-rule bg-white p-1">
            <a href={address({ span: "weeks" })} className={choice(span === "weeks")} aria-current={span === "weeks"}>
              Two weeks
            </a>
            <a href={address({ span: "month" })} className={choice(span === "month")} aria-current={span === "month"}>
              Month
            </a>
          </p>
          <p className="flex items-center rounded-full border border-rule bg-white p-1">
            <a
              href={address({ view: "grid" })}
              className={`${choice(view === "grid")} ${view === "auto" ? "md:bg-night-900 md:text-mist-50" : ""}`}
            >
              Grid
            </a>
            <a
              href={address({ view: "list" })}
              className={`${choice(view === "list")} ${view === "auto" ? "max-md:bg-night-900 max-md:text-mist-50" : ""}`}
            >
              Day by day
            </a>
          </p>
        </div>
      </div>

      <div className={`mt-4 ${gridShown}`}>
        <Panel className="overflow-hidden">
          <CalendarGrid
            days={shown.days}
            today={today}
            rows={shown.rooms.map((room) => ({
              id: room.id,
              name: room.name,
              typeName: room.typeName,
              sleeps: room.sleeps,
            }))}
            bars={bars}
            canMake={may(staff, "bookings.make")}
            canBlock={may(staff, "calendar.block")}
            back={address({})}
          />
        </Panel>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink-soft">
          {(Object.keys(BAR_LOOKS) as BarState[]).map((state) => (
            <li key={state} className="flex items-center gap-2">
              <span className={`inline-block h-3.5 w-7 rounded-full ${BAR_LOOKS[state].className}`} />
              {BAR_LOOKS[state].name}
            </li>
          ))}
        </ul>
        {may(staff, "bookings.change") ? (
          <p className="mt-2 hidden text-sm text-ink-faint lg:block">
            Drag a booking to another room or other dates. You are shown what the move does before anything is saved.
          </p>
        ) : null}
      </div>

      <ol className={`mt-4 space-y-3 ${listShown}`}>
        {shown.days.map((day) => {
          const arriving = bars.filter((bar) => bar.bookingId !== null && bar.from === day);
          const leaving = bars.filter((bar) => bar.bookingId !== null && bar.to === day);
          const staying = bars.filter((bar) => bar.bookingId !== null && bar.from < day && bar.to > day);
          const blocked = bars.filter((bar) => bar.bookingId === null && bar.from <= day && bar.to > day);
          const taken = bars.filter((bar) => bar.from <= day && bar.to > day).length;
          const groups: [string, CalendarBar[]][] = [
            ["Arriving", arriving],
            ["Leaving", leaving],
            ["Staying", staying],
            ["Off sale", blocked],
          ];
          return (
            <li key={day}>
              <Panel>
                <div
                  className={`flex items-baseline justify-between gap-3 px-4 py-3 ${day === today ? "rounded-t-xl bg-ember-100" : ""}`}
                >
                  <h2 className="font-semibold">
                    {formatDay(day, "long").replace(/ \d{4}$/, "")}
                    {day === today ? <span className="ml-2 font-normal text-ember-800">Today</span> : null}
                  </h2>
                  <p className="tabular text-sm whitespace-nowrap text-ink-faint">
                    {taken} of {shown.rooms.length} taken
                  </p>
                </div>
                {groups.every(([, list]) => list.length === 0) ? (
                  <p className="border-t border-rule px-4 py-3 text-sm text-ink-faint">Every room is free.</p>
                ) : (
                  <dl className="divide-y divide-rule border-t border-rule">
                    {groups
                      .filter(([, list]) => list.length > 0)
                      .map(([heading, list]) => (
                        <div key={heading} className="grid grid-cols-[5.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="label pt-1 text-ink-faint">{heading}</dt>
                          <dd>
                            <ul className="space-y-1">
                              {list.map((bar) => (
                                <li key={bar.key} className="flex flex-wrap items-baseline gap-x-2">
                                  {bar.bookingId === null ? (
                                    <span>{bar.label}</span>
                                  ) : (
                                    <a
                                      href={`/desk/bookings/${bar.bookingId}`}
                                      className="font-medium underline-offset-4 hover:underline"
                                    >
                                      {bar.label}
                                    </a>
                                  )}
                                  <span className="text-sm text-ink-faint">
                                    {roomName.get(bar.roomId)}
                                    {bar.bookingId === null ? "" : ` · ${BAR_LOOKS[bar.state].name}`}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </dd>
                        </div>
                      ))}
                  </dl>
                )}
              </Panel>
            </li>
          );
        })}
      </ol>
    </DeskPage>
  );
}
