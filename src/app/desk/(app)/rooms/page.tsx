import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { connection } from "next/server";

import { DeskPage, Empty, Panel, Tabs } from "@/components/desk/page";
import { proposed, ReviewPanel, waitingChange } from "@/components/desk/review";
import { type Day, addDays, lodgeDay } from "@/lib/dates";
import { formatDay, plural } from "@/lib/format";
import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { may } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Rooms and prices" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const TABS = { rooms: "Rooms", prices: "Prices", seasons: "Seasons and shortest stays", meals: "Meals and extras" };
type Tab = keyof typeof TABS;

const field = "field min-h-10 py-2";
const smallButton = "button min-h-10 px-4 py-2 text-sm";
const whole = { inputMode: "numeric", pattern: "[0-9,]+", required: true } as const;
const lastNight = (to: Day) => addDays(to, -1);

/** What every form here carries: which change it makes, and the screen to come back to. */
function Hidden({ action, back }: { action: string; back: string }) {
  return (
    <>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="back" value={back} />
    </>
  );
}

export default async function RoomsPage({ searchParams }: PageProps<"/desk/rooms">) {
  await connection();
  const staff = await requireStaff("rates.edit");
  const query = await searchParams;
  const tab: Tab = one(query.tab) in TABS ? (one(query.tab) as Tab) : "rooms";
  const back = tab === "rooms" ? "/desk/rooms" : `/desk/rooms?tab=${tab}`;
  const canEdit = may(staff, "rates.edit");
  const waiting = waitingChange(query.review, staff);
  const today = lodgeDay(clock.now());

  const types = await db().select().from(schema.roomTypes).orderBy(asc(schema.roomTypes.position));
  const rooms = await db().select().from(schema.rooms).orderBy(asc(schema.rooms.position));
  const seasons = await db().select().from(schema.seasons).orderBy(asc(schema.seasons.position));
  const dates = await db().select().from(schema.seasonDates);
  const rates = await db().select().from(schema.rates);
  const stayRules = await db().select().from(schema.stayRules);
  const plans = await db().select().from(schema.mealPlans).orderBy(asc(schema.mealPlans.position));
  const extras = await db().select().from(schema.extras).orderBy(asc(schema.extras.position));

  // A change being reviewed keeps what was typed in the form, in case it needs one more correction.
  const typedRates = proposed<{ rates: [number, number, number, number][] }>(waiting, "prices");
  const rate = (typeId: number, seasonId: number) => {
    const typed = typedRates?.rates.find((row) => row[0] === typeId && row[1] === seasonId);
    const saved = rates.find((row) => row.roomTypeId === typeId && row.seasonId === seasonId);
    return {
      weeknight: (typed?.[2] ?? saved?.weeknightCents ?? 0) / 100,
      weekend: (typed?.[3] ?? saved?.weekendCents ?? 0) / 100,
    };
  };

  const coming = [...dates]
    .filter((row) => row.dates.to > today)
    .sort((a, b) => a.dates.from.localeCompare(b.dates.from));
  const past = dates.length - coming.length;
  const rulesAhead = stayRules
    .filter((rule) => rule.dates.to > today)
    .sort((a, b) => a.dates.from.localeCompare(b.dates.from));

  return (
    <DeskPage
      title="Rooms and prices"
      summary={
        canEdit
          ? "What the lodge sells and what it costs. Changes apply to bookings made from now on."
          : "What the lodge sells and what it costs. Training accounts can look, and cannot change it."
      }
      query={query}
      wide
    >
      <Tabs
        label="Show"
        items={(Object.keys(TABS) as Tab[]).map((key) => ({
          href: key === "rooms" ? "/desk/rooms" : `/desk/rooms?tab=${key}`,
          label: TABS[key],
          current: tab === key,
        }))}
      />
      <div className="mt-4">
        <ReviewPanel waiting={waiting} back={back} />
      </div>

      <fieldset disabled={!canEdit} className="min-w-0 space-y-4">
        {tab === "rooms"
          ? types
              .filter((type) => type.active)
              .map((type) => {
                const own = rooms.filter((room) => room.roomTypeId === type.id);
                return (
                  <Panel
                    key={type.id}
                    title={type.name}
                    action={
                      <span className="text-sm text-ink-faint">
                        {plural(own.filter((room) => room.active).length, "room")} in use · sleeps {type.sleeps}
                      </span>
                    }
                  >
                    <div className="grid gap-6 px-4 py-4 sm:px-5 lg:grid-cols-[1.5fr_1fr]">
                      <form action="/desk/setup/act" method="post" className="grid gap-3 sm:grid-cols-2">
                        <Hidden back={back} action="room-type" />
                        <input type="hidden" name="id" value={type.id} />
                        <label className="block">
                          <span className="field-label">Name</span>
                          <input name="name" required maxLength={60} defaultValue={type.name} className={field} />
                        </label>
                        <label className="block">
                          <span className="field-label">Beds</span>
                          <input name="beds" maxLength={80} defaultValue={type.beds} className={field} />
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="field-label">The line under the name</span>
                          <input name="tagline" maxLength={120} defaultValue={type.tagline} className={field} />
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="field-label">Description</span>
                          <textarea
                            name="description"
                            rows={6}
                            maxLength={2000}
                            defaultValue={type.description}
                            className="field"
                          />
                        </label>
                        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
                          <label className="block">
                            <span className="field-label">Sleeps</span>
                            <input name="sleeps" {...whole} defaultValue={type.sleeps} className={`${field} tabular`} />
                          </label>
                          <label className="block">
                            <span className="field-label">Bedrooms</span>
                            <input
                              name="bedrooms"
                              {...whole}
                              defaultValue={type.bedrooms}
                              className={`${field} tabular`}
                            />
                          </label>
                          <label className="block">
                            <span className="field-label">Size, m²</span>
                            <input
                              name="size"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              defaultValue={type.sizeSqm ?? ""}
                              className={`${field} tabular`}
                            />
                          </label>
                        </div>
                        <label className="block sm:col-span-2">
                          <span className="field-label">What is in it, one thing to a line</span>
                          <textarea
                            name="features"
                            rows={Math.max(4, type.features.length)}
                            defaultValue={type.features.join("\n")}
                            className="field"
                          />
                        </label>
                        {canEdit ? (
                          <div className="sm:col-span-2">
                            <button type="submit" className={`${smallButton} button-night`}>
                              Save {type.name}
                            </button>
                          </div>
                        ) : null}
                      </form>

                      <div>
                        <h3 className="field-label">Its rooms</h3>
                        <ul className="divide-y divide-rule border-y border-rule">
                          {own.map((room) => (
                            <li key={room.id} className="py-2.5">
                              <form
                                action="/desk/setup/act"
                                method="post"
                                className="flex flex-wrap items-center gap-2"
                              >
                                <Hidden back={back} action="room-change" />
                                <input type="hidden" name="id" value={room.id} />
                                <label className="min-w-0 flex-1">
                                  <span className="sr-only">Name of the room</span>
                                  <input
                                    name="name"
                                    required
                                    maxLength={40}
                                    defaultValue={room.name}
                                    className={`${field} ${room.active ? "" : "text-ink-faint line-through"}`}
                                  />
                                </label>
                                {canEdit ? (
                                  <>
                                    <button type="submit" className={`${smallButton} button-line`}>
                                      Rename
                                    </button>
                                    <button
                                      type="submit"
                                      name="use"
                                      value={room.active ? "out" : "in"}
                                      className={`${smallButton} button-line`}
                                    >
                                      {room.active ? "Take out of use" : "Put back in use"}
                                    </button>
                                  </>
                                ) : null}
                              </form>
                              {room.active ? null : (
                                <p className="mt-1 text-sm text-ink-faint">Out of use. Its past stays are kept.</p>
                              )}
                            </li>
                          ))}
                        </ul>
                        {canEdit ? (
                          <form action="/desk/setup/act" method="post" className="mt-3 flex items-end gap-2">
                            <Hidden back={back} action="room-add" />
                            <input type="hidden" name="type" value={type.id} />
                            <label className="min-w-0 flex-1">
                              <span className="field-label">Add a room</span>
                              <input name="name" required maxLength={40} placeholder="Its name" className={field} />
                            </label>
                            <button type="submit" className={`${smallButton} button-line`}>
                              Add
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  </Panel>
                );
              })
          : null}

        {tab === "prices" ? (
          <Panel title="A night, in shillings, with breakfast">
            <form action="/desk/setup/act" method="post">
              <Hidden back={back} action="prices" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-[0.95rem]">
                  <thead>
                    <tr className="label border-b border-rule text-ink-faint">
                      <th scope="col" rowSpan={2} className="px-5 py-3 align-bottom font-semibold">
                        Kind of room
                      </th>
                      {seasons.map((season) => (
                        <th
                          key={season.id}
                          scope="colgroup"
                          colSpan={2}
                          className="border-l border-rule px-3 pt-3 text-center font-semibold"
                        >
                          {season.name}
                          {season.isDefault ? " (every other night)" : ""}
                        </th>
                      ))}
                    </tr>
                    <tr className="border-b border-rule text-xs text-ink-faint">
                      {seasons.flatMap((season) => [
                        <th key={`w${season.id}`} scope="col" className="border-l border-rule px-3 py-2 font-normal">
                          Sun to Thu
                        </th>,
                        <th key={`e${season.id}`} scope="col" className="px-3 py-2 font-normal">
                          Fri and Sat
                        </th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {types
                      .filter((type) => type.active)
                      .map((type) => (
                        <tr key={type.id}>
                          <th scope="row" className="px-5 py-3 font-semibold whitespace-nowrap">
                            {type.name}
                          </th>
                          {seasons.flatMap((season) => {
                            const now = rate(type.id, season.id);
                            return (["weeknight", "weekend"] as const).map((kind) => (
                              <td
                                key={`${season.id}${kind}`}
                                className={`px-2 py-2 ${kind === "weeknight" ? "border-l border-rule" : ""}`}
                              >
                                <input
                                  name={`${kind === "weeknight" ? "w" : "e"}-${type.id}-${season.id}`}
                                  {...whole}
                                  defaultValue={now[kind]}
                                  aria-label={`${type.name}, ${season.name}, ${kind === "weeknight" ? "Sunday to Thursday nights" : "Friday and Saturday nights"}`}
                                  className={`${field} tabular w-24 text-right`}
                                />
                              </td>
                            ));
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3 sm:px-5">
                  <button type="submit" className={`${smallButton} button-night`}>
                    See what changes
                  </button>
                  <p className="text-sm text-ink-faint">Nothing is saved until you have checked the list of changes.</p>
                </div>
              ) : null}
            </form>
          </Panel>
        ) : null}

        {tab === "seasons" ? (
          <>
            <Panel
              title="Which nights are in which season"
              action={
                past ? <span className="text-sm text-ink-faint">{plural(past, "past period")} not shown</span> : null
              }
            >
              {coming.length === 0 ? (
                <Empty>Every night is in the usual season.</Empty>
              ) : (
                <ul className="divide-y divide-rule">
                  {coming.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <p>
                        <span className="font-semibold">
                          {seasons.find((season) => season.id === row.seasonId)?.name}
                        </span>
                        <span className="text-ink-soft">
                          {" "}
                          · {formatDay(row.dates.from, "compact")} to {formatDay(lastNight(row.dates.to))}
                          {row.label ? ` · ${row.label}` : ""}
                        </span>
                      </p>
                      {canEdit ? (
                        <form action="/desk/setup/act" method="post">
                          <Hidden back={back} action="season-remove" />
                          <input type="hidden" name="id" value={row.id} />
                          <button type="submit" className="link text-sm">
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <form
                  action="/desk/setup/act"
                  method="post"
                  className="grid gap-3 border-t border-rule px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto] lg:items-end"
                >
                  <Hidden back={back} action="season-add" />
                  <label className="block">
                    <span className="field-label">Season</span>
                    <select name="season" required className={field}>
                      {seasons
                        .filter((season) => !season.isDefault)
                        .map((season) => (
                          <option key={season.id} value={season.id}>
                            {season.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">A name for these dates</span>
                    <input
                      name="label"
                      required
                      maxLength={60}
                      placeholder="Christmas and New Year"
                      className={field}
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">First night</span>
                    <input name="from" type="date" required min={today} className={`${field} tabular`} />
                  </label>
                  <label className="block">
                    <span className="field-label">Last night</span>
                    <input name="last" type="date" required min={today} className={`${field} tabular`} />
                  </label>
                  <button type="submit" className={`${smallButton} button-night`}>
                    See what changes
                  </button>
                </form>
              ) : null}
            </Panel>

            <Panel title="Dates when a stay must be longer than one night">
              {rulesAhead.length === 0 ? (
                <Empty>A stay of one night can be booked for any date.</Empty>
              ) : (
                <ul className="divide-y divide-rule">
                  {rulesAhead.map((rule) => (
                    <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <p>
                        <span className="font-semibold">{rule.label}</span>
                        <span className="text-ink-soft">
                          {" "}
                          · {formatDay(rule.dates.from, "compact")} to {formatDay(lastNight(rule.dates.to))} · at least{" "}
                          {plural(rule.minNights, "night")}
                        </span>
                      </p>
                      {canEdit ? (
                        <form action="/desk/setup/act" method="post">
                          <Hidden back={back} action="stay-remove" />
                          <input type="hidden" name="id" value={rule.id} />
                          <button type="submit" className="link text-sm">
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <form
                  action="/desk/setup/act"
                  method="post"
                  className="grid gap-3 border-t border-rule px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-[1.4fr_1fr_1fr_0.7fr_auto] lg:items-end"
                >
                  <Hidden back={back} action="stay-add" />
                  <label className="block">
                    <span className="field-label">A name for these dates</span>
                    <input name="label" required maxLength={60} placeholder="Easter weekend" className={field} />
                  </label>
                  <label className="block">
                    <span className="field-label">First night</span>
                    <input name="from" type="date" required min={today} className={`${field} tabular`} />
                  </label>
                  <label className="block">
                    <span className="field-label">Last night</span>
                    <input name="last" type="date" required min={today} className={`${field} tabular`} />
                  </label>
                  <label className="block">
                    <span className="field-label">Nights</span>
                    <input name="min" {...whole} defaultValue={2} className={`${field} tabular`} />
                  </label>
                  <button type="submit" className={`${smallButton} button-night`}>
                    See what changes
                  </button>
                </form>
              ) : null}
            </Panel>
          </>
        ) : null}

        {tab === "meals" ? (
          <>
            <Panel title="Meal plans, for each guest each night, in shillings">
              <form action="/desk/setup/act" method="post">
                <Hidden back={back} action="meals" />
                <ul className="divide-y divide-rule">
                  {plans.map((plan) => (
                    <li key={plan.code} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[1fr_2fr_0.6fr_0.6fr]">
                      <label className="block">
                        <span className="field-label">Name</span>
                        <input
                          name={`name-${plan.code}`}
                          required
                          maxLength={40}
                          defaultValue={plan.name}
                          className={field}
                        />
                      </label>
                      <label className="block">
                        <span className="field-label">What is included</span>
                        <input
                          name={`description-${plan.code}`}
                          maxLength={200}
                          defaultValue={plan.description}
                          className={field}
                        />
                      </label>
                      <label className="block">
                        <span className="field-label">Adult</span>
                        <input
                          name={`adult-${plan.code}`}
                          {...whole}
                          defaultValue={plan.adultCents / 100}
                          className={`${field} tabular text-right`}
                        />
                      </label>
                      <label className="block">
                        <span className="field-label">Child</span>
                        <input
                          name={`child-${plan.code}`}
                          {...whole}
                          defaultValue={plan.childCents / 100}
                          className={`${field} tabular text-right`}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
                {canEdit ? (
                  <div className="border-t border-rule px-4 py-3 sm:px-5">
                    <button type="submit" className={`${smallButton} button-night`}>
                      See what changes
                    </button>
                  </div>
                ) : null}
              </form>
            </Panel>

            <Panel title="Extras, in shillings">
              <form action="/desk/setup/act" method="post">
                <Hidden back={back} action="extras" />
                <ul className="divide-y divide-rule">
                  {[...extras, null].map((extra) => {
                    const id = extra?.id ?? "new";
                    if (!extra && !canEdit) return null;
                    return (
                      <li
                        key={id}
                        className={`grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-[1.6fr_1fr_0.7fr_1fr_auto] lg:items-end ${extra ? "" : "bg-mist-50"}`}
                      >
                        <label className="block">
                          <span className="field-label">{extra ? "Name" : "Add an extra: its name"}</span>
                          <input
                            name={`name-${id}`}
                            required={Boolean(extra)}
                            maxLength={60}
                            defaultValue={extra?.name ?? ""}
                            className={field}
                          />
                        </label>
                        <label className="block">
                          <span className="field-label">How long it takes</span>
                          <input
                            name={`duration-${id}`}
                            maxLength={40}
                            defaultValue={extra?.duration ?? ""}
                            placeholder="2 hours"
                            className={field}
                          />
                        </label>
                        <label className="block">
                          <span className="field-label">Price</span>
                          <input
                            name={`price-${id}`}
                            inputMode="numeric"
                            pattern="[0-9,]+"
                            required={Boolean(extra)}
                            defaultValue={extra ? extra.priceCents / 100 : ""}
                            className={`${field} tabular text-right`}
                          />
                        </label>
                        <label className="block">
                          <span className="field-label">Charged</span>
                          <select
                            name={`charged-${id}`}
                            defaultValue={extra?.charged ?? "per_person"}
                            className={field}
                          >
                            <option value="per_person">For each guest</option>
                            <option value="per_booking">Once a booking</option>
                          </select>
                        </label>
                        {extra ? (
                          <label className="flex min-h-10 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name={`active-${id}`}
                              defaultChecked={extra.active}
                              className="size-5 accent-night-900"
                            />
                            Offered
                          </label>
                        ) : (
                          <span />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {canEdit ? (
                  <div className="border-t border-rule px-4 py-3 sm:px-5">
                    <button type="submit" className={`${smallButton} button-night`}>
                      See what changes
                    </button>
                  </div>
                ) : null}
              </form>
            </Panel>
          </>
        ) : null}
      </fieldset>
    </DeskPage>
  );
}
