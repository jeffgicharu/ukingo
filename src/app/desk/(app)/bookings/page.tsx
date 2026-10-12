import type { Metadata } from "next";
import { connection } from "next/server";

import { BookingChip } from "@/components/desk/chips";
import { DeskPage, Empty, Panel } from "@/components/desk/page";
import { nightsIn } from "@/lib/dates";
import { formatDay, formatMoney, plural } from "@/lib/format";
import {
  listBookings,
  nameFor,
  PAGE_SIZE,
  readBookingFilters,
  STATE_FILTERS,
  type StateFilter,
} from "@/server/desk/bookings";
import { catalogue } from "@/server/lodge/catalogue";
import { may } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage({ searchParams }: PageProps<"/desk/bookings">) {
  await connection();
  const staff = await requireStaff("bookings.view");
  const query = await searchParams;
  const filters = readBookingFilters(query);
  const [{ rows, total }, lodge] = [await listBookings(filters), await catalogue()];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const address = (changes: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    const all = {
      q: filters.q,
      state: filters.state,
      type: filters.roomType,
      from: filters.from,
      to: filters.to,
      ...changes,
    };
    for (const [key, value] of Object.entries(all)) {
      if (value !== null && value !== "" && !(key === "state" && value === "coming")) params.set(key, String(value));
    }
    const text = params.toString();
    return text ? `/desk/bookings?${text}` : "/desk/bookings";
  };

  return (
    <DeskPage
      title="Bookings"
      summary={filters.q ? `${plural(total, "booking")} match “${filters.q}”` : `${plural(total, "booking")}`}
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
      <nav aria-label="Show" className="flex flex-wrap gap-1.5">
        {(Object.keys(STATE_FILTERS) as StateFilter[]).map((state) => (
          <a
            key={state}
            href={address({ state, page: null, q: "" })}
            aria-current={!filters.q && filters.state === state ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              !filters.q && filters.state === state
                ? "bg-night-900 text-mist-50"
                : "bg-white text-ink-soft ring-1 ring-rule hover:text-ink"
            }`}
          >
            {STATE_FILTERS[state].label}
          </a>
        ))}
      </nav>

      <form
        action="/desk/bookings"
        method="get"
        className="mt-4 grid gap-3 rounded-xl border border-rule bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1.2fr_1fr_1fr_auto] lg:items-end"
      >
        <input type="hidden" name="state" value={filters.state} />
        <label className="block">
          <span className="field-label">Name, phone or reference</span>
          <input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Wanjiru, 0712…, UKG-…"
            className="field min-h-10 py-2"
          />
        </label>
        <label className="block">
          <span className="field-label">Room</span>
          <select name="type" defaultValue={filters.roomType ?? ""} className="field min-h-10 py-2">
            <option value="">Any</option>
            {lodge.roomTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Arriving from</span>
          <input name="from" type="date" defaultValue={filters.from ?? ""} className="field tabular min-h-10 py-2" />
        </label>
        <label className="block">
          <span className="field-label">To</span>
          <input name="to" type="date" defaultValue={filters.to ?? ""} className="field tabular min-h-10 py-2" />
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <button type="submit" className="button button-night min-h-10 px-5 py-2 text-sm">
            Search
          </button>
          {filters.q || filters.roomType || filters.from || filters.to ? (
            <a
              href={address({ q: "", type: null, from: null, to: null, page: null })}
              className="button button-line min-h-10 px-4 py-2 text-sm"
            >
              Clear
            </a>
          ) : null}
        </div>
      </form>

      <Panel className="mt-4 overflow-hidden">
        {rows.length === 0 ? (
          <Empty>{filters.q ? "No booking matches that search." : "There are no bookings here."}</Empty>
        ) : (
          <>
            {/* A table on a laptop. On a phone each booking is a short card. */}
            <table className="hidden w-full text-left text-[0.95rem] md:table">
              <thead>
                <tr className="label border-b border-rule text-ink-faint">
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Guest
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Room
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Stay
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    State
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">
                    Total
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    To pay
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map(({ booking, roomName, roomTypeName, money }) => (
                  <tr key={booking.id} className="hover:bg-mist-50">
                    <td className="px-5 py-3">
                      <a
                        href={`/desk/bookings/${booking.id}`}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        {nameFor(staff, { name: booking.guestName, sample: booking.sample })}
                      </a>
                      <p className="tabular text-sm text-ink-faint">{booking.reference}</p>
                    </td>
                    <td className="px-3 py-3">
                      {roomName}
                      <p className="text-sm text-ink-faint">{roomTypeName}</p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {formatDay(booking.stay.from, "compact")} to {formatDay(booking.stay.to)}
                      <p className="text-sm text-ink-faint">
                        {plural(nightsIn(booking.stay), "night")} · {plural(booking.adults + booking.children, "guest")}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <BookingChip status={booking.status} money={money} />
                    </td>
                    <td className="tabular px-3 py-3 text-right whitespace-nowrap">
                      {formatMoney(booking.totalCents)}
                    </td>
                    <td className="tabular px-5 py-3 text-right font-medium whitespace-nowrap">
                      {money.owedCents > 0 ? (
                        formatMoney(money.owedCents)
                      ) : (
                        <span className="font-normal text-ink-faint">Nothing</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-rule md:hidden">
              {rows.map(({ booking, roomName, money }) => (
                <li key={booking.id}>
                  <a href={`/desk/bookings/${booking.id}`} className="block px-4 py-3">
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-semibold">
                        {nameFor(staff, { name: booking.guestName, sample: booking.sample })}
                      </span>
                      <BookingChip status={booking.status} money={money} />
                    </span>
                    <span className="mt-1 block text-sm text-ink-soft">
                      {roomName} · {formatDay(booking.stay.from, "compact")} to {formatDay(booking.stay.to, "compact")}{" "}
                      · {plural(nightsIn(booking.stay), "night")}
                    </span>
                    <span className="tabular mt-0.5 block text-sm text-ink-faint">
                      {booking.reference} ·{" "}
                      {money.owedCents > 0 ? `${formatMoney(money.owedCents)} to pay` : "nothing to pay"}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-sm">
          {filters.page > 1 ? (
            <a href={address({ page: filters.page - 1 })} className="button button-line min-h-9 px-4 py-1.5 text-sm">
              Earlier
            </a>
          ) : (
            <span />
          )}
          <span className="tabular text-ink-faint">
            Page {filters.page} of {pages}
          </span>
          {filters.page < pages ? (
            <a href={address({ page: filters.page + 1 })} className="button button-line min-h-9 px-4 py-1.5 text-sm">
              Later
            </a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </DeskPage>
  );
}
