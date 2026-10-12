import { addDays, type Day, weekday } from "@/lib/dates";

export type BookingBarValues = {
  from?: string;
  to?: string;
  adults?: number;
  children?: number;
};

/** The next Friday that is at least three days away, for two nights. */
export function suggestedStay(first: Day): { from: Day; to: Day } {
  let from = addDays(first, 3);
  while (weekday(from) !== 5) {
    from = addDays(from, 1);
  }
  return { from, to: addDays(from, 2) };
}

/**
 * Dates and guests. A plain form that asks the /stay page a question, so it
 * works on any phone, with or without script.
 */
export function BookingBar({
  first,
  lastDeparture,
  values = {},
  maxGuests,
  room,
  tone = "light",
  idPrefix = "bar",
}: {
  first: Day;
  lastDeparture: Day;
  values?: BookingBarValues;
  maxGuests: number;
  /** Keeps the search to one kind of room. */
  room?: string;
  tone?: "light" | "plain";
  idPrefix?: string;
}) {
  const suggestion = suggestedStay(first);
  const from = values.from ?? suggestion.from;
  const to = values.to ?? suggestion.to;

  return (
    <form
      action="/stay"
      method="get"
      className={
        tone === "light"
          ? "rounded-2xl bg-mist-50 p-4 text-ink shadow-lift ring-1 ring-night-900/5 sm:p-5"
          : "rounded-2xl border border-rule bg-white p-4 text-ink sm:p-5"
      }
    >
      {room ? <input type="hidden" name="room" value={room} /> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_0.7fr_0.7fr_auto] lg:items-end">
        <div>
          <label htmlFor={`${idPrefix}-in`} className="field-label">
            Arrive
          </label>
          <input
            id={`${idPrefix}-in`}
            type="date"
            name="in"
            required
            defaultValue={from}
            min={first}
            max={addDays(lastDeparture, -1)}
            className="field tabular"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-out`} className="field-label">
            Leave
          </label>
          <input
            id={`${idPrefix}-out`}
            type="date"
            name="out"
            required
            defaultValue={to}
            min={addDays(first, 1)}
            max={lastDeparture}
            className="field tabular"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-adults`} className="field-label">
            Adults
          </label>
          <select id={`${idPrefix}-adults`} name="adults" defaultValue={String(values.adults ?? 2)} className="field">
            {Array.from({ length: maxGuests }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-children`} className="field-label">
            Children <span className="font-normal normal-case tracking-normal">3 to 11</span>
          </label>
          <select
            id={`${idPrefix}-children`}
            name="children"
            defaultValue={String(values.children ?? 0)}
            className="field"
          >
            {Array.from({ length: maxGuests }, (_, index) => index).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="button button-ember col-span-2 lg:col-span-1">
          See what is free
        </button>
      </div>
    </form>
  );
}
