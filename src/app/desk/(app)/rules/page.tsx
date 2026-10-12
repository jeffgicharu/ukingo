import type { Metadata } from "next";
import { connection } from "next/server";

import { DeskPage, Panel } from "@/components/desk/page";
import { proposed, ReviewPanel, waitingChange } from "@/components/desk/review";
import { db, schema } from "@/server/db";
import { rulesOf } from "@/server/desk/setup";
import { may } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Booking rules" };

type Rules = ReturnType<typeof rulesOf>;

/** A number in the middle of a sentence. */
function Amount({ rules, name, label, max }: { rules: Rules; name: keyof Rules; label: string; max: number }) {
  return (
    <input
      name={name}
      aria-label={label}
      inputMode="numeric"
      pattern="[0-9]+"
      required
      maxLength={String(max).length}
      defaultValue={rules[name]}
      className="field tabular mx-1.5 inline-block min-h-9 w-[4.5rem] py-1.5 text-center align-baseline"
    />
  );
}

export default async function RulesPage({ searchParams }: PageProps<"/desk/rules">) {
  await connection();
  const staff = await requireStaff("rules.edit");
  const query = await searchParams;
  const canEdit = may(staff, "rules.edit");
  const waiting = waitingChange(query.review, staff);

  const [settings] = await db().select().from(schema.settings);
  // A change being reviewed keeps what was typed, in case it needs one more correction.
  const rules = proposed<Rules>(waiting, "rules") ?? rulesOf(settings);

  const line = "leading-[2.75]";

  return (
    <DeskPage
      title="Booking rules"
      summary={
        canEdit
          ? "The terms a guest books under. A booking keeps the terms it was made with, whatever changes here later."
          : "The terms a guest books under. Training accounts can look, and cannot change them."
      }
      query={query}
    >
      <ReviewPanel waiting={waiting} back="/desk/rules" />

      <form action="/desk/setup/act" method="post">
        <input type="hidden" name="action" value="rules" />
        <input type="hidden" name="back" value="/desk/rules" />
        <fieldset disabled={!canEdit} className="min-w-0 space-y-4">
          <Panel title="Paying">
            <div className="px-4 py-3 sm:px-5">
              <p className={line}>
                A booking is confirmed by a deposit of
                <Amount rules={rules} name="depositPercent" label="Deposit, percent of the total" max={100} />% of the
                total.
              </p>
              <p className={line}>
                The balance is due
                <Amount rules={rules} name="balanceDueDays" label="Days before arrival the balance is due" max={90} />
                days before arrival. A booking made closer than that is paid in full.
              </p>
              <p className={line}>
                While a guest pays online, the room is held for
                <Amount rules={rules} name="holdMinutes" label="Minutes a room is held" max={60} />
                minutes.
              </p>
              <p className={line}>
                A booking made by staff waits for its deposit for
                <Amount
                  rules={rules}
                  name="provisionalHours"
                  label="Hours a staff booking waits for its deposit"
                  max={168}
                />
                hours, and is then let go.
              </p>
            </div>
          </Panel>

          <Panel title="Cancelling and changing">
            <div className="px-4 py-3 sm:px-5">
              <p className={line}>
                A guest who cancels
                <Amount
                  rules={rules}
                  name="freeUntilDays"
                  label="Days before arrival until which cancelling is free"
                  max={180}
                />
                days or more before arrival is refunded everything.
              </p>
              <p className={line}>
                After that, and until
                <Amount
                  rules={rules}
                  name="partUntilDays"
                  label="Days before arrival until which part is refunded"
                  max={180}
                />
                days before arrival, the lodge keeps
                <Amount rules={rules} name="partKeepPercent" label="Percent of the total kept" max={100} />% of the
                total and refunds the rest.
              </p>
              <p className="py-2 text-ink-soft">Closer to arrival than that, there is no refund.</p>
              <p className={line}>
                Guests can move their own dates until
                <Amount
                  rules={rules}
                  name="changeUntilDays"
                  label="Days before arrival until which guests can change dates"
                  max={90}
                />
                days before arrival. After that they ask the front desk.
              </p>
            </div>
          </Panel>

          <Panel title="What can be booked online">
            <div className="px-4 py-3 sm:px-5">
              <p className={line}>
                Bookings open
                <Amount rules={rules} name="bookingWindowMonths" label="Months ahead bookings open" max={24} />
                months ahead.
              </p>
              <p className={line}>
                A room for tonight can be booked online until
                <Amount
                  rules={rules}
                  name="sameDayUntilHour"
                  label="Hour of the day tonight closes online, 0 to 23"
                  max={23}
                />
                :00.
              </p>
              <p className={line}>
                The longest stay that can be booked online is
                <Amount rules={rules} name="maxNights" label="Longest stay online, in nights" max={60} />
                nights.
              </p>
              <p className="py-2 text-sm text-ink-faint">
                Staff may book for tonight after that hour, and for longer stays, from the back office.
              </p>
            </div>
          </Panel>

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="button button-night min-h-10 px-5 py-2 text-sm">
                See what changes
              </button>
              <p className="text-sm text-ink-faint">Nothing is saved until you have checked the list of changes.</p>
            </div>
          ) : null}
        </fieldset>
      </form>
    </DeskPage>
  );
}
