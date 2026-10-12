"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { addDays, addMonths, type Day, daysBetween, isDay, startOfMonth, weekday } from "@/lib/dates";
import { formatDay, formatMoney, plural } from "@/lib/format";

type Night = { free: number; from: number | null };
type Answer = { first: Day; lastDeparture: Day; nights: Record<Day, Night> };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** 1,650,000 cents as "16.5k". */
function short(cents: number): string {
  const thousands = cents / 100_000;
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
}

/** The weeks of a month, Monday first. Null marks a cell outside the month. */
function weeksOf(month: Day): (Day | null)[][] {
  const lead = (weekday(month) + 6) % 7;
  const length = daysBetween(month, addMonths(month, 1));
  const cells: (Day | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, index) => addDays(month, index)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/**
 * A calendar of the months ahead showing, for every night, whether a room is
 * free and the least it costs. Choosing an arrival and a departure here fills
 * in the two date fields beside it, which still work on their own.
 */
export function StayCalendar({
  idPrefix,
  room,
  first,
  lastDeparture,
}: {
  idPrefix: string;
  room?: string;
  first: Day;
  lastDeparture: Day;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Day>(startOfMonth(first));
  const [nights, setNights] = useState<Record<Day, Night>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [from, setFrom] = useState<Day | null>(null);
  const [to, setTo] = useState<Day | null>(null);
  const [focusDay, setFocusDay] = useState<Day | null>(null);
  const fetched = useRef(new Set<string>());
  const grid = useRef<HTMLDivElement>(null);

  const field = useCallback(
    (which: "in" | "out") => document.getElementById(`${idPrefix}-${which}`) as HTMLInputElement | null,
    [idPrefix],
  );

  // The calendar starts from whatever dates the fields already hold, and follows them if they are typed into.
  useEffect(() => {
    const read = () => {
      const arrive = field("in")?.value;
      const leave = field("out")?.value;
      setFrom(isDay(arrive) ? arrive : null);
      setTo(isDay(leave) && isDay(arrive) && leave > arrive ? leave : null);
    };
    read();
    const inputs = [field("in"), field("out")];
    inputs.forEach((input) => input?.addEventListener("change", read));
    return () => inputs.forEach((input) => input?.removeEventListener("change", read));
  }, [field]);

  useEffect(() => {
    if (!open) return;
    const key = `${month}:${room ?? ""}`;
    if (fetched.current.has(key)) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch(`/availability?from=${month}&months=2${room ? `&room=${encodeURIComponent(room)}` : ""}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? (response.json() as Promise<Answer>) : Promise.reject(new Error("failed"))))
      .then((answer) => {
        if (cancelled) return;
        fetched.current.add(key);
        setNights((current) => ({ ...current, ...answer.nights }));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, month, room]);

  // After the arrow keys move to a day in another month, put the keyboard's focus on it.
  useEffect(() => {
    if (!focusDay) return;
    grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, month]);

  const lastArrival = addDays(lastDeparture, -1);
  const selectable = (day: Day) => day >= first && day <= lastDeparture;

  function write(arrive: Day, leave: Day) {
    const inField = field("in");
    const outField = field("out");
    if (inField) inField.value = arrive;
    if (outField) outField.value = leave;
  }

  function choose(day: Day) {
    const night = nights[day];
    const full = night !== undefined && night.free === 0;

    // The second choice, after the arrival, is the day of leaving. A full night can be left on.
    if (from && !to && day > from) {
      setTo(day);
      write(from, day);
      return;
    }
    if (full || day > lastArrival) return;
    setFrom(day);
    setTo(null);
    write(day, addDays(day, 1));
  }

  function onKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const current = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-day]")?.dataset.day;
    if (!current) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = addDays(current, step);
    if (!selectable(next)) return;
    const nextMonth = startOfMonth(next);
    // Two months are on screen: only move the view when the day is in neither.
    if (nextMonth < month || nextMonth > addMonths(month, 1)) {
      setMonth(nextMonth < month ? nextMonth : addMonths(nextMonth, -1));
    }
    setFocusDay(next);
  }

  const canGoBack = month > startOfMonth(first);
  const canGoForward = addMonths(month, 2) < lastDeparture;
  const fullInside =
    from && to ? Object.entries(nights).some(([day, night]) => day >= from && day < to && night.free === 0) : false;

  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          // Opening the calendar shows the month of the arrival date already chosen.
          if (!open && from && from >= first) setMonth(startOfMonth(from));
          setOpen((value) => !value);
        }}
        className="link inline-flex items-center gap-2 text-[0.95rem]"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          className="size-4"
        >
          <rect x="3" y="4.5" width="14" height="12" rx="2" />
          <path d="M3 8.5h14M7 3v3M13 3v3" strokeLinecap="round" />
        </svg>
        {open ? "Hide the calendar" : "See prices and free nights on a calendar"}
      </button>

      {open ? (
        <div id={panelId} className="mt-4 rounded-xl border border-mist-300 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setMonth((value) => addMonths(value, -1))}
              disabled={!canGoBack}
              aria-label="Earlier months"
              className="flex size-10 items-center justify-center rounded-full border border-mist-300 hover:border-night-600 disabled:opacity-30 disabled:hover:border-mist-300"
            >
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
                className="size-3"
              >
                <path d="M7.5 2 3.5 6l4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <p className="text-center text-sm text-ink-faint" aria-live="polite">
              {from && to
                ? `${formatDay(from, "compact")} to ${formatDay(to, "compact")}, ${plural(daysBetween(from, to), "night")}`
                : from
                  ? `Arriving ${formatDay(from, "compact")}. Now choose the day you leave.`
                  : "Choose the day you arrive."}
            </p>
            <button
              type="button"
              onClick={() => setMonth((value) => addMonths(value, 1))}
              disabled={!canGoForward}
              aria-label="Later months"
              className="flex size-10 items-center justify-center rounded-full border border-mist-300 hover:border-night-600 disabled:opacity-30 disabled:hover:border-mist-300"
            >
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
                className="size-3"
              >
                <path d="m4.5 2 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div ref={grid} onKeyDown={onKey} className="mt-4 grid gap-8 md:grid-cols-2">
            {[month, addMonths(month, 1)].map((shown, index) => (
              <table
                key={shown}
                className={`w-full table-fixed border-collapse ${index === 1 ? "hidden md:table" : ""}`}
              >
                <caption className="display pb-3 text-left text-2xl">{formatDay(shown, "month")}</caption>
                <thead>
                  <tr>
                    {WEEKDAYS.map((name) => (
                      <th key={name} scope="col" className="label pb-2 text-center font-semibold text-ink-faint">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeksOf(shown).map((week, row) => (
                    <tr key={row}>
                      {week.map((day, column) => {
                        if (!day) return <td key={column} />;
                        const night = nights[day];
                        const outside = !selectable(day);
                        const full = night !== undefined && night.free === 0;
                        const isFrom = day === from;
                        const isTo = day === to;
                        const between = from !== null && to !== null && day > from && day < to;
                        // A full night cannot be arrived on, but can be the day of leaving.
                        const cannot =
                          outside || (full && !(from && !to && day > from)) || (day > lastArrival && !(from && !to));

                        return (
                          <td key={column} className="p-0.5">
                            <button
                              type="button"
                              data-day={day}
                              disabled={cannot}
                              onClick={() => choose(day)}
                              aria-pressed={isFrom || isTo}
                              aria-label={`${formatDay(day, "long")}${
                                outside
                                  ? ", not bookable"
                                  : full
                                    ? ", full"
                                    : night?.from
                                      ? `, from ${formatMoney(night.from)}`
                                      : ""
                              }${isFrom ? ", your arrival" : isTo ? ", your departure" : ""}`}
                              className={`flex h-12 w-full flex-col items-center justify-center rounded-lg text-sm leading-tight transition-colors ${
                                isFrom || isTo
                                  ? "bg-night-900 font-semibold text-mist-50"
                                  : between
                                    ? "bg-ember-100 text-ink"
                                    : outside
                                      ? "text-mist-300"
                                      : full
                                        ? "text-ink-faint"
                                        : "text-ink hover:bg-mist-100"
                              }`}
                            >
                              <span className={`tabular ${full && !isTo ? "line-through" : ""}`}>
                                {Number(day.slice(8))}
                              </span>
                              {!outside ? (
                                <span
                                  className={`tabular text-[0.65rem] ${isFrom || isTo ? "text-ember-300" : full ? "" : "text-ink-faint"}`}
                                >
                                  {full ? "Full" : night?.from ? short(night.from) : " "}
                                </span>
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>

          <p className="mt-4 text-sm text-ink-faint">
            {failed
              ? "Prices could not be loaded just now. You can still choose your dates."
              : loading
                ? "Loading prices…"
                : fullInside
                  ? "Some nights between those dates are full. Other rooms or dates may still be free."
                  : `The lowest price for the night, in thousands of shillings, with breakfast${room ? "" : ", across all rooms"}. A night struck through is full.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
