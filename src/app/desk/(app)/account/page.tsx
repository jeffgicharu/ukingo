import type { Metadata } from "next";
import { connection } from "next/server";

import { DeskPage, Panel } from "@/components/desk/page";
import { MIN_PASSWORD_LENGTH } from "@/server/staff/passwords";
import { ROLE_NAMES } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: PageProps<"/desk/account">) {
  await connection();
  const staff = await requireStaff();

  return (
    <DeskPage title="My account" query={await searchParams}>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Panel title="Who you are signed in as">
          <dl className="divide-y divide-rule">
            {[
              ["Name", staff.name],
              ["Email", staff.email],
              ["Role", `${ROLE_NAMES[staff.role]}${staff.training ? ", training account" : ""}`],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[5rem_1fr] gap-3 px-4 py-2.5 sm:px-5">
                <dt className="label pt-1 text-ink-faint">{label}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-rule px-4 py-3 text-sm text-ink-faint sm:px-5">
            An owner changes roles and gives out new passwords, under Staff.
          </p>
        </Panel>

        <Panel title="Change your password">
          {staff.training ? (
            <p className="px-4 py-4 text-ink-soft sm:px-5">
              This is a training account. It is shared, so its password cannot be changed.
            </p>
          ) : (
            <form action="/desk/account/act" method="post" className="space-y-3 px-4 py-4 sm:px-5">
              <label className="block">
                <span className="field-label">Your password now</span>
                <input
                  name="current"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="field min-h-10 py-2"
                />
              </label>
              <label className="block">
                <span className="field-label">New password</span>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  className="field min-h-10 py-2"
                />
                <span className="mt-1.5 block text-sm text-ink-faint">At least {MIN_PASSWORD_LENGTH} characters.</span>
              </label>
              <label className="block">
                <span className="field-label">The same again</span>
                <input
                  name="again"
                  type="password"
                  required
                  autoComplete="new-password"
                  className="field min-h-10 py-2"
                />
              </label>
              <button type="submit" className="button button-night min-h-10 px-4 py-2 text-sm">
                Change password
              </button>
              <p className="text-sm text-ink-faint">
                Every other device signed in as you is signed out. This one stays signed in.
              </p>
            </form>
          )}
        </Panel>
      </div>
    </DeskPage>
  );
}
