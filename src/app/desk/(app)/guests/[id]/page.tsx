import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { BookingChip } from "@/components/desk/chips";
import { DeskPage, Empty, Panel } from "@/components/desk/page";
import { nightsIn } from "@/lib/dates";
import { PHONE_PATTERN, formatDay, formatMoney, formatPhone, plural } from "@/lib/format";
import { emailFor, nameFor, phoneFor } from "@/server/desk/bookings";
import { guestProfile, REMOVED } from "@/server/desk/guests";
import { may } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Guest" };

const field = "field min-h-10 py-2";
const smallButton = "button min-h-10 px-4 py-2 text-sm";

export default async function GuestPage({ params, searchParams }: PageProps<"/desk/guests/[id]">) {
  await connection();
  const staff = await requireStaff("guests.view");
  const { id } = await params;
  const profile = await guestProfile(Number(id));
  if (!profile) notFound();

  const { guest, stays } = profile;
  // A training account sees a real visitor's details with the middle hidden, and so cannot edit them.
  const hidden = staff.training && !guest.sample;
  // Someone who asked to be forgotten has nothing left here to edit.
  const removed = guest.name === REMOVED;
  const canEdit = may(staff, "guests.edit") && !hidden && !removed;
  const act = `/desk/guests/${guest.id}/act`;
  const went = stays.filter((stay) => ["checked_in", "checked_out"].includes(stay.booking.status)).length;
  const coming = stays.filter((stay) => ["confirmed", "provisional"].includes(stay.booking.status)).length;

  return (
    <DeskPage
      title={nameFor(staff, guest)}
      summary={stays.length ? `${plural(went, "stay")} so far, ${coming} to come` : "Has not booked yet"}
      actions={
        <a href="/desk/guests" className={`${smallButton} button-line`}>
          All guests
        </a>
      }
      query={await searchParams}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr] lg:items-start">
        <div className="space-y-4">
          <Panel title="Contact">
            {canEdit ? (
              <form action={act} method="post" className="space-y-3 px-4 py-4 sm:px-5">
                <input type="hidden" name="action" value="details" />
                <label className="block">
                  <span className="field-label">Name</span>
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={guest.name}
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className="field-label">Mobile number</span>
                  <input
                    name="phone"
                    type="tel"
                    required
                    pattern={PHONE_PATTERN}
                    title="A Kenyan mobile number, such as 0712 345 678"
                    defaultValue={formatPhone(guest.phone)}
                    className={`${field} tabular`}
                  />
                </label>
                <label className="block">
                  <span className="field-label">Email</span>
                  <input name="email" type="email" maxLength={120} defaultValue={guest.email ?? ""} className={field} />
                </label>
                <button type="submit" className={`${smallButton} button-line`}>
                  Save contact details
                </button>
                <p className="text-sm text-ink-faint">
                  Used for bookings made from now on. Bookings already made keep the details they were made with.
                </p>
              </form>
            ) : (
              <dl className="divide-y divide-rule">
                {[
                  ["Phone", phoneFor(staff, guest)],
                  ["Email", emailFor(staff, guest) ?? "None given"],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[5rem_1fr] gap-3 px-4 py-2.5 sm:px-5">
                    <dt className="label pt-1 text-ink-faint">{label}</dt>
                    <dd className="break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {removed ? (
              <p className="border-t border-rule px-4 py-3 text-sm text-ink-faint sm:px-5">
                This guest asked for their details to be deleted. Their stays and payments are kept without a name.
              </p>
            ) : null}
            {hidden ? (
              <p className="border-t border-rule px-4 py-3 text-sm text-ink-faint sm:px-5">
                This is a real visitor. Training accounts see contact details with the middle hidden.
              </p>
            ) : null}
          </Panel>

          <Panel title="Notes">
            {canEdit ? (
              <form action={act} method="post" className="space-y-3 px-4 py-4 sm:px-5">
                <input type="hidden" name="action" value="notes" />
                <label className="block">
                  <span className="field-label">What the team should know about this guest</span>
                  <textarea
                    name="notes"
                    rows={4}
                    maxLength={2000}
                    defaultValue={guest.notes}
                    placeholder="Prefers Cedar. Vegetarian. Walks before breakfast."
                    className="field"
                  />
                </label>
                <button type="submit" className={`${smallButton} button-line`}>
                  Save notes
                </button>
              </form>
            ) : (
              <p className="px-4 py-4 whitespace-pre-line text-ink-soft sm:px-5">
                {hidden ? "Hidden from training accounts." : guest.notes || "No notes."}
              </p>
            )}
          </Panel>

          {may(staff, "guests.forget") && !staff.training && !removed ? (
            <details className="rounded-xl border border-rule bg-white shadow-panel">
              <summary className="cursor-pointer px-4 py-3 font-semibold text-heath-700 sm:px-5">
                Remove this guest&apos;s details
              </summary>
              <form action={act} method="post" className="space-y-3 border-t border-rule px-4 py-4 sm:px-5">
                <input type="hidden" name="action" value="forget" />
                <p className="text-[0.95rem] text-ink-soft">
                  For a guest who asks the lodge to delete what it holds about them. Their name, phone number, email
                  address, requests, notes and every message written to them are removed, here and on each of their
                  bookings. The stays and payments stay in the books without a name, as tax law requires.
                </p>
                <p className="text-[0.95rem] font-semibold">This cannot be undone.</p>
                <button type="submit" className="button min-h-10 bg-heath-700 px-4 py-2 text-sm text-white">
                  Remove their details for good
                </button>
              </form>
            </details>
          ) : null}
        </div>

        <div className="space-y-4">
          <Panel>
            <dl className="grid grid-cols-3 divide-x divide-rule text-center">
              {[
                ["Stays", String(went + coming)],
                ["Spent", formatMoney(profile.spentCents)],
                ["Owes", profile.owedCents > 0 ? formatMoney(profile.owedCents) : "Nothing"],
              ].map(([label, value]) => (
                <div key={label} className="px-2 py-4">
                  <dt className="label text-ink-faint">{label}</dt>
                  <dd className="display tabular mt-1 text-2xl whitespace-nowrap sm:text-3xl">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Bookings" count={stays.length}>
            {stays.length === 0 ? (
              <Empty>No bookings.</Empty>
            ) : (
              <ul className="divide-y divide-rule">
                {stays.map(({ booking, roomName, roomTypeName, money }) => (
                  <li key={booking.id}>
                    <a href={`/desk/bookings/${booking.id}`} className="block px-4 py-3 hover:bg-mist-50 sm:px-5">
                      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <span className="font-semibold">
                          {formatDay(booking.stay.from, "compact")} to {formatDay(booking.stay.to)}
                        </span>
                        <BookingChip status={booking.status} money={money} />
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-soft">
                        {roomName}, {roomTypeName} · {plural(nightsIn(booking.stay), "night")} ·{" "}
                        {plural(booking.adults + booking.children, "guest")}
                      </span>
                      <span className="tabular mt-0.5 block text-sm text-ink-faint">
                        {booking.reference} · {formatMoney(booking.totalCents)}
                        {money.owedCents > 0 ? ` · ${formatMoney(money.owedCents)} to pay` : ""}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </DeskPage>
  );
}
