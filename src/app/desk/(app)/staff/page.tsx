import { asc, desc } from "drizzle-orm";
import type { Metadata } from "next";
import { connection } from "next/server";

import { Chip } from "@/components/desk/chips";
import { DeskPage, Panel } from "@/components/desk/page";
import { formatMoment, plural } from "@/lib/format";
import { db, schema } from "@/server/db";
import { MIN_PASSWORD_LENGTH } from "@/server/staff/passwords";
import { may, ROLE_NAMES } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Staff" };

const field = "field min-h-10 py-2";
const smallButton = "button min-h-10 px-4 py-2 text-sm";

const CAN: Record<keyof typeof ROLE_NAMES, string> = {
  owner: "Everything, and the only role that manages staff and the lodge's details.",
  reservations: "Bookings and payments, refunds and discounts, prices, rules and the words on the site.",
  front_desk: "Bookings, check-in and check-out, taking payments, blocking rooms.",
};

export default async function StaffPage({ searchParams }: PageProps<"/desk/staff">) {
  await connection();
  const me = await requireStaff("staff.manage");
  const canManage = may(me, "staff.manage");
  const people = await db().select().from(schema.staff).orderBy(desc(schema.staff.active), asc(schema.staff.name));
  const on = people.filter((person) => person.active).length;

  return (
    <DeskPage
      title="Staff"
      summary={
        canManage
          ? `${plural(on, "person", "people")} can sign in. An account is switched off, never deleted, so history keeps each name.`
          : "Who can sign in. Training accounts can look, and cannot change it."
      }
      query={await searchParams}
    >
      <fieldset disabled={!canManage} className="min-w-0 space-y-4">
        <Panel title="People" count={people.length}>
          <ul className="divide-y divide-rule">
            {people.map((person) => {
              const self = person.id === me.id;
              return (
                <li key={person.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className={`font-semibold ${person.active ? "" : "text-ink-faint line-through"}`}>
                        {person.name}
                        {self ? <span className="ml-2 font-normal text-ink-faint no-underline">you</span> : null}
                      </p>
                      <p className="text-sm break-all text-ink-soft">{person.email}</p>
                      <p className="mt-0.5 text-sm text-ink-faint">
                        {person.lastSignInAt
                          ? `Last signed in ${formatMoment(person.lastSignInAt)}`
                          : "Has never signed in"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {person.training ? <Chip label="Training" tone="wait" /> : null}
                      <Chip
                        label={person.active ? ROLE_NAMES[person.role] : "Switched off"}
                        tone={person.active ? "booked" : "gone"}
                      />
                    </div>
                  </div>

                  {canManage ? (
                    <details className="mt-3">
                      <summary className="link cursor-pointer text-sm">Change</summary>
                      <form
                        action="/desk/staff/act"
                        method="post"
                        className="mt-3 grid gap-3 rounded-lg bg-mist-50 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                      >
                        <input type="hidden" name="action" value="details" />
                        <input type="hidden" name="id" value={person.id} />
                        <label className="block">
                          <span className="field-label">Name</span>
                          <input
                            name="name"
                            required
                            minLength={2}
                            maxLength={80}
                            defaultValue={person.name}
                            className={field}
                          />
                        </label>
                        <label className="block">
                          <span className="field-label">Email they sign in with</span>
                          <input
                            name="email"
                            type="email"
                            required
                            maxLength={120}
                            defaultValue={person.email}
                            className={field}
                          />
                        </label>
                        <button type="submit" className={`${smallButton} button-line`}>
                          Save
                        </button>
                      </form>
                      {self ? (
                        <p className="mt-2 text-sm text-ink-faint">
                          Your own role and password are not changed here. Change your password under My account.
                        </p>
                      ) : null}
                      {self ? null : (
                        <div className="mt-3 grid gap-4 rounded-lg bg-mist-50 p-4 lg:grid-cols-3">
                          <form action="/desk/staff/act" method="post" className="flex items-end gap-2">
                            <input type="hidden" name="action" value="role" />
                            <input type="hidden" name="id" value={person.id} />
                            <label className="min-w-0 flex-1">
                              <span className="field-label">Role</span>
                              <select name="role" defaultValue={person.role} className={field}>
                                {(Object.keys(ROLE_NAMES) as (keyof typeof ROLE_NAMES)[]).map((role) => (
                                  <option key={role} value={role}>
                                    {ROLE_NAMES[role]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button type="submit" className={`${smallButton} button-line`}>
                              Save
                            </button>
                          </form>

                          <form action="/desk/staff/act" method="post" className="flex items-end gap-2">
                            <input type="hidden" name="action" value="password" />
                            <input type="hidden" name="id" value={person.id} />
                            <label className="min-w-0 flex-1">
                              <span className="field-label">Give a new password</span>
                              <input
                                name="password"
                                type="password"
                                required
                                minLength={MIN_PASSWORD_LENGTH}
                                autoComplete="new-password"
                                className={field}
                              />
                            </label>
                            <button type="submit" className={`${smallButton} button-line`}>
                              Set
                            </button>
                          </form>

                          <form action="/desk/staff/act" method="post" className="flex items-end">
                            <input type="hidden" name="action" value="use" />
                            <input type="hidden" name="id" value={person.id} />
                            <input type="hidden" name="active" value={person.active ? "0" : "1"} />
                            <button type="submit" className={`${smallButton} button-line`}>
                              {person.active ? "Switch this account off" : "Switch this account back on"}
                            </button>
                          </form>
                        </div>
                      )}
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Panel>

        {canManage ? (
          <Panel title="Add someone">
            <form action="/desk/staff/act" method="post" className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <input type="hidden" name="action" value="add" />
              <label className="block">
                <span className="field-label">Name</span>
                <input name="name" required minLength={2} maxLength={80} autoComplete="off" className={field} />
              </label>
              <label className="block">
                <span className="field-label">Email they sign in with</span>
                <input name="email" type="email" required maxLength={120} autoComplete="off" className={field} />
              </label>
              <label className="block">
                <span className="field-label">Role</span>
                <select name="role" defaultValue="front_desk" className={field}>
                  {(Object.keys(ROLE_NAMES) as (keyof typeof ROLE_NAMES)[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_NAMES[role]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">A first password</span>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  className={field}
                />
                <span className="mt-1.5 block text-sm text-ink-faint">
                  At least {MIN_PASSWORD_LENGTH} characters. Tell it to them yourself. They change it under My account.
                </span>
              </label>
              <div className="sm:col-span-2">
                <button type="submit" className={`${smallButton} button-night`}>
                  Add to the staff
                </button>
              </div>
            </form>
          </Panel>
        ) : null}

        <Panel title="What each role can do">
          <dl className="divide-y divide-rule">
            {(Object.keys(ROLE_NAMES) as (keyof typeof ROLE_NAMES)[]).map((role) => (
              <div key={role} className="grid gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:px-5">
                <dt className="font-semibold">{ROLE_NAMES[role]}</dt>
                <dd className="text-ink-soft">{CAN[role]}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </fieldset>
    </DeskPage>
  );
}
