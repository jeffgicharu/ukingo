import type { Metadata } from "next";
import { connection } from "next/server";

import { DeskPage, Empty, Pager, Panel } from "@/components/desk/page";
import { lodgeDay } from "@/lib/dates";
import { formatDay, formatMoney, plural } from "@/lib/format";
import { clock } from "@/server/clock";
import { emailFor, nameFor, phoneFor } from "@/server/desk/bookings";
import { GUESTS_PER_PAGE, listGuests, type ListedGuest } from "@/server/desk/guests";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Guests" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function GuestsPage({ searchParams }: PageProps<"/desk/guests">) {
  await connection();
  const staff = await requireStaff("guests.view");
  const query = await searchParams;
  const q = one(query.q).trim().slice(0, 80);
  const page = Math.max(1, Number(one(query.page)) || 1);

  const { rows, total } = await listGuests(q, page, lodgeDay(clock.now()));
  const address = (next: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (next > 1) params.set("page", String(next));
    const text = params.toString();
    return text ? `/desk/guests?${text}` : "/desk/guests";
  };

  const when = (guest: ListedGuest) =>
    guest.nextStay
      ? `Coming ${formatDay(guest.nextStay, "compact")}`
      : guest.lastStay
        ? `Last here ${formatDay(guest.lastStay)}`
        : "Has not stayed yet";

  return (
    <DeskPage
      title="Guests"
      summary={q ? `${plural(total, "guest")} match “${q}”` : plural(total, "guest")}
      query={query}
      wide
    >
      <form
        action="/desk/guests"
        method="get"
        className="grid gap-3 rounded-xl border border-rule bg-white p-4 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <label className="block">
          <span className="field-label">Name, phone or email</span>
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Wanjiru, 0712…, name@…"
            className="field min-h-10 py-2"
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="button button-night min-h-10 px-5 py-2 text-sm">
            Search
          </button>
          {q ? (
            <a href="/desk/guests" className="button button-line min-h-10 px-4 py-2 text-sm">
              Clear
            </a>
          ) : null}
        </div>
      </form>

      <Panel className="mt-4 overflow-hidden">
        {rows.length === 0 ? (
          <Empty>{q ? "No guest matches that search." : "Nobody has booked yet."}</Empty>
        ) : (
          <>
            <table className="hidden w-full text-left text-[0.95rem] md:table">
              <thead>
                <tr className="label border-b border-rule text-ink-faint">
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Guest
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Phone
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Email
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Stays
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    Spent
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((guest) => (
                  <tr key={guest.id} className="hover:bg-mist-50">
                    <td className="px-5 py-3">
                      <a href={`/desk/guests/${guest.id}`} className="font-semibold underline-offset-4 hover:underline">
                        {nameFor(staff, guest)}
                      </a>
                    </td>
                    <td className="tabular px-3 py-3 whitespace-nowrap">{phoneFor(staff, guest)}</td>
                    <td className="px-3 py-3 break-all">{emailFor(staff, guest) ?? "—"}</td>
                    <td className="px-3 py-3">
                      <span className="tabular">{guest.stays}</span>
                      <p className="text-sm whitespace-nowrap text-ink-faint">{when(guest)}</p>
                    </td>
                    <td className="amount px-5 py-3 text-right">
                      {guest.spentCents > 0 ? formatMoney(guest.spentCents) : <span className="text-ink-faint">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-rule md:hidden">
              {rows.map((guest) => (
                <li key={guest.id}>
                  <a href={`/desk/guests/${guest.id}`} className="block px-4 py-3">
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-semibold">{nameFor(staff, guest)}</span>
                      <span className="amount text-sm">
                        {guest.spentCents > 0 ? formatMoney(guest.spentCents) : ""}
                      </span>
                    </span>
                    <span className="tabular mt-0.5 block text-sm text-ink-soft">{phoneFor(staff, guest)}</span>
                    <span className="mt-0.5 block text-sm text-ink-faint">
                      {plural(guest.stays, "stay")} · {when(guest)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / GUESTS_PER_PAGE))} href={address} />
    </DeskPage>
  );
}
