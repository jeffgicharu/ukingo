import type { Metadata } from "next";
import { connection } from "next/server";

import { DeskPage, Panel } from "@/components/desk/page";
import { formatMoment } from "@/lib/format";
import { db, schema } from "@/server/db";
import { may } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Settings" };

const field = "field min-h-10 py-2";

export default async function SettingsPage({ searchParams }: PageProps<"/desk/settings">) {
  await connection();
  const staff = await requireStaff("settings.edit");
  const canEdit = may(staff, "settings.edit");
  const [settings] = await db().select().from(schema.settings);

  return (
    <DeskPage
      title="Settings"
      summary={
        canEdit
          ? "The lodge's own details, as they appear on the site and in every message."
          : "The lodge's own details. Training accounts can look, and cannot change them."
      }
      query={await searchParams}
    >
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <Panel title="The lodge">
          <form action="/desk/setup/act" method="post">
            <input type="hidden" name="action" value="lodge" />
            <input type="hidden" name="back" value="/desk/settings" />
            <fieldset disabled={!canEdit} className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <label className="block">
                <span className="field-label">Name</span>
                <input name="lodgeName" required maxLength={60} defaultValue={settings.lodgeName} className={field} />
              </label>
              <label className="block">
                <span className="field-label">Where it is</span>
                <input name="place" required maxLength={80} defaultValue={settings.place} className={field} />
              </label>
              <label className="block">
                <span className="field-label">Check-in is from</span>
                <input
                  name="checkInFrom"
                  required
                  maxLength={20}
                  defaultValue={settings.checkInFrom}
                  className={field}
                />
              </label>
              <label className="block">
                <span className="field-label">Check-out is by</span>
                <input name="checkOutBy" required maxLength={20} defaultValue={settings.checkOutBy} className={field} />
              </label>
              {canEdit ? (
                <div className="sm:col-span-2">
                  <button type="submit" className="button button-night min-h-10 px-4 py-2 text-sm">
                    Save
                  </button>
                </div>
              ) : null}
            </fieldset>
          </form>
          <p className="border-t border-rule px-4 py-3 text-sm text-ink-faint sm:px-5">
            Last changed {formatMoment(settings.updatedAt)}. Times are written as guests will read them: “2&nbsp;pm”,
            “10.30&nbsp;am”.
          </p>
        </Panel>

        <Panel title="Kept elsewhere">
          <ul className="divide-y divide-rule">
            {[
              ["/desk/rules", "Booking rules", "Deposit, balance, cancelling, how far ahead"],
              ["/desk/rooms", "Rooms and prices", "Rooms, seasons, prices, meals and extras"],
              ["/desk/pages", "Pages", "The words on the site"],
              ["/desk/staff", "Staff", "Who can sign in, and as what"],
            ].map(([href, name, about]) => (
              <li key={href}>
                <a href={href} className="block px-4 py-3 hover:bg-mist-50 sm:px-5">
                  <span className="font-semibold">{name}</span>
                  <span className="block text-sm text-ink-faint">{about}</span>
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </DeskPage>
  );
}
