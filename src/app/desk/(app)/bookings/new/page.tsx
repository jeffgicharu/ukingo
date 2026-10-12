import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { DeskPage, Panel } from "@/components/desk/page";
import { addDays, isDay, lodgeDay, nightsIn } from "@/lib/dates";
import { formatDay, formatMoney, formatStay, plural } from "@/lib/format";
import { freeRooms } from "@/server/booking/availability";
import { quote } from "@/server/booking/pricing";
import { checkDates, fits, termsFor } from "@/server/booking/rules";
import { defaultMealPlan } from "@/server/booking/search";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { catalogue } from "@/server/lodge/catalogue";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "New booking" };

const field = "field min-h-10 py-2";
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function NewBookingPage({ searchParams }: PageProps<"/desk/bookings/new">) {
  await connection();
  await requireStaff("bookings.make");
  const query = await searchParams;
  const lodge = await catalogue();
  const now = clock.now();
  const today = lodgeDay(now);

  const from = isDay(one(query.in)) ? one(query.in) : "";
  const to = isDay(one(query.out)) ? one(query.out) : "";
  const adults = Math.max(1, Number(one(query.adults)) || 2);
  const children = Math.max(0, Number(one(query.children)) || 0);
  const party = { adults, children };
  // Coming from the calendar, the room is already chosen.
  const wantedRoom = Number(one(query.room)) || null;
  const typeOfWanted = wantedRoom
    ? lodge.roomTypes.find((type) => type.rooms.some((room) => room.id === wantedRoom))
    : undefined;
  const typeId = Number(one(query.type)) || typeOfWanted?.id || null;
  const roomType = lodge.roomTypes.find((type) => type.id === typeId);

  const stay = from && to && from < to ? { from, to } : null;
  // Staff may book a short stay over a holiday or tonight after the cut-off. Other faults still stop them.
  const fault = stay ? checkDates(lodge, stay, now) : null;
  const blocking = fault && !["too_late_today", "too_short", "too_long"].includes(fault.code) ? fault : null;

  const options =
    stay && !blocking
      ? await Promise.all(
          lodge.roomTypes.map(async (type) => ({
            type,
            free: await freeRooms(db(), type.id, stay, now),
            fits: fits(type, party),
          })),
        )
      : [];
  const chosen = roomType ? options.find((option) => option.type.id === roomType.id) : undefined;
  const ready = stay && chosen && chosen.fits && chosen.free.length > 0;
  const priced = ready ? quote(lodge, { roomType: chosen.type, stay, party, mealPlan: defaultMealPlan(lodge) }) : null;
  const terms = priced && stay ? termsFor(lodge.settings, stay, priced.totalCents, today) : null;

  return (
    <DeskPage
      title="New booking"
      summary="For a guest on the phone or at the desk. The room is held until the deposit deadline, then let go by itself."
      actions={
        <Link href="/desk/bookings" className="button button-line min-h-10 px-4 py-2 text-sm">
          All bookings
        </Link>
      }
      query={query}
    >
      <Panel title="1. Dates and guests">
        <form
          action="/desk/bookings/new"
          method="get"
          className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-[1fr_1fr_0.6fr_0.6fr_1.2fr_auto] lg:items-end"
        >
          <label className="block">
            <span className="field-label">Arrive</span>
            <input
              type="date"
              name="in"
              required
              defaultValue={from || today}
              min={today}
              className={`${field} tabular`}
            />
          </label>
          <label className="block">
            <span className="field-label">Leave</span>
            <input
              type="date"
              name="out"
              required
              defaultValue={to || addDays(today, 1)}
              min={addDays(today, 1)}
              className={`${field} tabular`}
            />
          </label>
          <label className="block">
            <span className="field-label">Adults</span>
            <input type="number" name="adults" min={1} max={8} defaultValue={adults} className={`${field} tabular`} />
          </label>
          <label className="block">
            <span className="field-label">Children</span>
            <input
              type="number"
              name="children"
              min={0}
              max={7}
              defaultValue={children}
              className={`${field} tabular`}
            />
          </label>
          <label className="block">
            <span className="field-label">Room</span>
            <select name="type" defaultValue={typeId ?? ""} className={field}>
              <option value="">Show all</option>
              {lodge.roomTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button button-night min-h-10 px-5 py-2 text-sm">
            Check
          </button>
        </form>

        {blocking ? <p className="border-t border-rule px-4 py-3 text-heath-700 sm:px-5">{blocking.message}</p> : null}
        {fault && !blocking ? (
          <p className="border-t border-rule px-4 py-3 text-ember-800 sm:px-5">
            Online this would be refused: {fault.message} You may still book it here.
          </p>
        ) : null}

        {stay && !blocking ? (
          <ul className="divide-y divide-rule border-t border-rule">
            {options.map((option) => {
              const current = option.type.id === roomType?.id;
              const href = `/desk/bookings/new?in=${stay.from}&out=${stay.to}&adults=${adults}&children=${children}&type=${option.type.id}`;
              return (
                <li
                  key={option.type.id}
                  className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5 ${current ? "bg-mist-100" : ""}`}
                >
                  <div>
                    <p className="font-semibold">{option.type.name}</p>
                    <p className="text-sm text-ink-faint">
                      Sleeps {option.type.sleeps} ·{" "}
                      {!option.fits
                        ? "too small for this party"
                        : option.free.length
                          ? `${option.free.length} free: ${option.free.map((room) => room.name).join(", ")}`
                          : "none free for these nights"}
                    </p>
                  </div>
                  {option.fits && option.free.length ? (
                    current ? (
                      <span className="label text-ink-faint">Chosen</span>
                    ) : (
                      <Link href={href} className="button button-line min-h-9 px-4 py-1.5 text-sm">
                        Choose
                      </Link>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Panel>

      {ready && priced && terms && stay ? (
        <Panel title="2. The guest" className="mt-5">
          <form
            action="/desk/bookings/make"
            method="post"
            className="grid gap-5 px-4 py-4 sm:px-5 lg:grid-cols-[1.4fr_1fr]"
          >
            <input type="hidden" name="type" value={chosen.type.slug} />
            <input type="hidden" name="in" value={stay.from} />
            <input type="hidden" name="out" value={stay.to} />
            <input type="hidden" name="adults" value={adults} />
            <input type="hidden" name="children" value={children} />
            <input type="hidden" name="key" value={randomUUID()} />
            {wantedRoom && chosen.free.some((room) => room.id === wantedRoom) ? (
              <input type="hidden" name="room" value={wantedRoom} />
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="field-label">Full name</span>
                <input name="name" required minLength={2} maxLength={80} className={field} />
              </label>
              <label className="block">
                <span className="field-label">Mobile number</span>
                <input name="phone" type="tel" required placeholder="0712 345 678" className={`${field} tabular`} />
              </label>
              <label className="block">
                <span className="field-label">
                  Email <span className="font-normal normal-case tracking-normal">for the payment link</span>
                </span>
                <input name="email" type="email" maxLength={120} className={field} />
              </label>
              <label className="block">
                <span className="field-label">Meals</span>
                <select name="meals" defaultValue={defaultMealPlan(lodge)} className={field}>
                  {lodge.mealPlans.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Arriving</span>
                <input name="arrival" maxLength={60} placeholder="About 4 pm" className={field} />
              </label>
              <label className="block sm:col-span-2">
                <span className="field-label">Requests</span>
                <textarea name="requests" rows={2} maxLength={1000} className="field" />
              </label>
              <fieldset className="sm:col-span-2">
                <legend className="field-label">Extras</legend>
                <div className="mt-1 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {lodge.extras.map((extra) => (
                    <label key={extra.id} className="flex items-center gap-2 text-[0.95rem]">
                      <input type="checkbox" name="extra" value={extra.id} className="size-4 accent-night-900" />
                      {extra.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="rounded-xl bg-mist-100 p-4">
              <p className="font-semibold">
                {chosen.type.name}, {formatStay(stay)}
              </p>
              <p className="text-sm text-ink-faint">
                {plural(nightsIn(stay), "night")} · {plural(adults + children, "guest")}
              </p>
              <dl className="tabular mt-3 space-y-1.5 border-t border-rule pt-3 text-[0.95rem]">
                {priced.nights.map((night) => (
                  <div key={night.night} className="flex justify-between gap-3">
                    <dt className="text-ink-soft">{formatDay(night.night, "compact")}</dt>
                    <dd>{formatMoney(night.cents)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-rule pt-2 font-semibold">
                  <dt>Room, with breakfast</dt>
                  <dd>{formatMoney(priced.totalCents)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-ink-soft">
                Meals and extras are added when the booking is made.{" "}
                {terms.balance_due
                  ? `A deposit of ${terms.deposit_percent}% confirms it, and the balance is due by ${formatDay(terms.balance_due)}.`
                  : "This stay is close, so the whole amount is due to confirm it."}
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                The room is held for {plural(lodge.settings.provisionalHours, "hour")}. If the guest gave an email, they
                are sent the amount and a link to pay.
              </p>
              <button type="submit" className="button button-ember mt-4 w-full">
                Make the booking
              </button>
            </div>
          </form>
        </Panel>
      ) : null}
    </DeskPage>
  );
}
