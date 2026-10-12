import type { Metadata } from "next";
import { connection } from "next/server";

import { Chip } from "@/components/desk/chips";
import { DeskPage, Empty, Pager, Panel, Tabs } from "@/components/desk/page";
import { methodName } from "@/components/site/booking-parts";
import { lodgeDay } from "@/lib/dates";
import { formatDay, formatMoment, formatMoney, plural } from "@/lib/format";
import { clock } from "@/server/clock";
import { nameFor, phoneFor } from "@/server/desk/bookings";
import {
  balances,
  listPayments,
  PAYMENT_STATES,
  PAYMENTS_PER_PAGE,
  refundsList,
  type Balance,
  type PaymentState,
} from "@/server/desk/money";
import { failureMessage } from "@/server/payments/daraja";
import { may } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Payments" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
type Tab = "payments" | "balances" | "refunds";

export default async function PaymentsPage({ searchParams }: PageProps<"/desk/payments">) {
  await connection();
  const staff = await requireStaff("bookings.view");
  const query = await searchParams;

  const tab: Tab = one(query.tab) === "balances" ? "balances" : one(query.tab) === "refunds" ? "refunds" : "payments";
  const state = (one(query.state) in PAYMENT_STATES ? one(query.state) : "all") as PaymentState;
  const q = one(query.q).trim().slice(0, 80);
  const page = Math.max(1, Number(one(query.page)) || 1);
  const today = lodgeDay(clock.now());

  // The counts on the tabs come from the same lists the tabs show.
  const [owing, refunds] = [await balances(today), await refundsList()];
  const payments = tab === "payments" ? await listPayments({ state, q, page }) : null;

  const address = (changes: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    const all: Record<string, string | number | null> = { tab, state, q, page: null, ...changes };
    for (const [key, value] of Object.entries(all)) {
      if (value === null || value === "") continue;
      if ((key === "tab" && value === "payments") || (key === "state" && value === "all")) continue;
      params.set(key, String(value));
    }
    const text = params.toString();
    return text ? `/desk/payments?${text}` : "/desk/payments";
  };

  const guest = (row: { guestName: string; sample: boolean }) =>
    nameFor(staff, { name: row.guestName, sample: row.sample });

  return (
    <DeskPage title="Payments" summary="Money received, money still owed, and money owed back." query={query} wide>
      <Tabs
        label="Show"
        items={[
          {
            href: address({ tab: "payments", state: "all", q: "" }),
            label: "Payments",
            current: tab === "payments",
          },
          {
            href: address({ tab: "balances", state: "all", q: "" }),
            label: "Balances",
            current: tab === "balances",
            count: owing.overdue.length,
          },
          {
            href: address({ tab: "refunds", state: "all", q: "" }),
            label: "Refunds",
            current: tab === "refunds",
            count: refunds.owed.length,
          },
        ]}
      />

      {tab === "payments" && payments ? (
        <>
          <form
            action="/desk/payments"
            method="get"
            className="mt-4 grid gap-3 rounded-xl border border-rule bg-white p-4 sm:grid-cols-[2fr_1.2fr_auto] sm:items-end"
          >
            <label className="block">
              <span className="field-label">M-Pesa receipt, name or reference</span>
              <input
                name="q"
                type="search"
                defaultValue={q}
                placeholder="TJC4X81ABQ, Wanjiru, UKG-…"
                className="field min-h-10 py-2"
              />
            </label>
            <label className="block">
              <span className="field-label">State</span>
              <select name="state" defaultValue={state} className="field min-h-10 py-2">
                {(Object.keys(PAYMENT_STATES) as PaymentState[]).map((key) => (
                  <option key={key} value={key}>
                    {PAYMENT_STATES[key].label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" className="button button-night min-h-10 px-5 py-2 text-sm">
                Search
              </button>
              {q || state !== "all" ? (
                <a href={address({ q: "", state: "all" })} className="button button-line min-h-10 px-4 py-2 text-sm">
                  Clear
                </a>
              ) : null}
            </div>
          </form>

          <Panel className="mt-4 overflow-hidden">
            {payments.rows.length === 0 ? (
              <Empty>{q || state !== "all" ? "No payment matches that." : "No payment has been made yet."}</Empty>
            ) : (
              <>
                <table className="hidden w-full text-left text-[0.95rem] md:table">
                  <thead>
                    <tr className="label border-b border-rule text-ink-faint">
                      <th scope="col" className="px-5 py-3 font-semibold">
                        When
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold">
                        Booking
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold">
                        How
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold">
                        Receipt
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold">
                        State
                      </th>
                      <th scope="col" className="px-5 py-3 text-right font-semibold">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {payments.rows.map((row) => (
                      <tr key={row.payment.id} className="align-top hover:bg-mist-50">
                        <td className="px-5 py-3 whitespace-nowrap">
                          {formatMoment(row.payment.settledAt ?? row.payment.requestedAt)}
                        </td>
                        <td className="px-3 py-3">
                          <a
                            href={`/desk/bookings/${row.bookingId}`}
                            className="font-semibold underline-offset-4 hover:underline"
                          >
                            {guest(row)}
                          </a>
                          <p className="tabular text-sm text-ink-faint">{row.reference}</p>
                        </td>
                        <td className="px-3 py-3">
                          {methodName(row.payment.method)}
                          {row.recordedBy ? <p className="text-sm text-ink-faint">Taken by {row.recordedBy}</p> : null}
                        </td>
                        <td className="tabular px-3 py-3">{row.payment.receipt ?? "—"}</td>
                        <td className="max-w-xs px-3 py-3">
                          <PaymentChip status={row.payment.status} />
                          {row.payment.status === "failed" ? (
                            <p className="mt-1 text-sm text-ink-faint">
                              {failureMessage(row.payment.failure).split(". ")[0]}.
                            </p>
                          ) : null}
                        </td>
                        <td
                          className={`amount px-5 py-3 text-right font-medium ${
                            row.payment.status === "paid" ? "" : "text-ink-faint line-through"
                          }`}
                        >
                          {formatMoney(row.payment.cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <ul className="divide-y divide-rule md:hidden">
                  {payments.rows.map((row) => (
                    <li key={row.payment.id}>
                      <a href={`/desk/bookings/${row.bookingId}`} className="block px-4 py-3">
                        <span className="flex items-start justify-between gap-3">
                          <span className="font-semibold">{guest(row)}</span>
                          <span
                            className={`amount font-medium ${row.payment.status === "paid" ? "" : "text-ink-faint line-through"}`}
                          >
                            {formatMoney(row.payment.cents)}
                          </span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
                          <PaymentChip status={row.payment.status} />
                          {methodName(row.payment.method)}
                          {row.payment.receipt ? <span className="tabular">· {row.payment.receipt}</span> : null}
                        </span>
                        <span className="tabular mt-0.5 block text-sm text-ink-faint">
                          {row.reference} · {formatMoment(row.payment.settledAt ?? row.payment.requestedAt)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
          <Pager
            page={page}
            pages={Math.max(1, Math.ceil(payments.total / PAYMENTS_PER_PAGE))}
            href={(next) => address({ page: next })}
          />
        </>
      ) : null}

      {tab === "balances" ? (
        <div className="mt-4 space-y-4">
          <BalanceList
            title="Overdue"
            rows={owing.overdue}
            empty="Nothing is overdue."
            name={guest}
            line={(row) =>
              row.booking.status === "checked_out"
                ? `Left owing · departed ${formatDay(row.booking.checkedOutAt ? lodgeDay(row.booking.checkedOutAt) : row.booking.stay.to, "compact")}`
                : `${row.booking.terms.balance_due ? `Was due ${formatDay(row.booking.terms.balance_due, "compact")}` : "Was due at booking"} · arrives ${formatDay(row.booking.stay.from, "compact")}`
            }
            late
          />
          <BalanceList
            title="In house, to settle at check-out"
            rows={owing.inHouse}
            empty="No guest in the house owes anything."
            name={guest}
            line={(row) => `${row.roomName} · leaves ${formatDay(row.booking.stay.to, "compact")}`}
          />
          <BalanceList
            title="Due in the next 14 days"
            rows={owing.dueSoon}
            empty="No balance falls due in the next fortnight."
            name={guest}
            line={(row) =>
              `Due ${formatDay(row.booking.terms.balance_due ?? row.booking.stay.from, "compact")} · arrives ${formatDay(row.booking.stay.from, "compact")}`
            }
          />
          {owing.later.count ? (
            <p className="text-sm text-ink-faint">
              {plural(owing.later.count, "more balance")} worth {formatMoney(owing.later.cents)}{" "}
              {owing.later.count === 1 ? "falls" : "fall"} due after that.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "refunds" ? (
        <div className="mt-4 space-y-4">
          <Panel title="To send" count={refunds.owed.length}>
            {refunds.owed.length === 0 ? (
              <Empty>No refund is waiting to be sent.</Empty>
            ) : (
              <ul className="divide-y divide-rule">
                {refunds.owed.map((row) => (
                  <li key={row.refund.id} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-4">
                        <a
                          href={`/desk/bookings/${row.bookingId}`}
                          className="font-semibold underline-offset-4 hover:underline"
                        >
                          {guest(row)}
                        </a>
                        <span className="amount text-lg font-semibold">{formatMoney(row.refund.cents)}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-ink-soft">{row.refund.reason}</p>
                      <p className="tabular mt-0.5 text-sm text-ink-faint">
                        {row.reference} · to {phoneFor(staff, { phone: row.guestPhone, sample: row.sample })} · owed
                        since {formatMoment(row.refund.createdAt)}
                      </p>
                    </div>
                    {may(staff, "refunds.send") ? (
                      <form
                        action={`/desk/bookings/${row.bookingId}/act`}
                        method="post"
                        className="flex items-end gap-2"
                      >
                        <input type="hidden" name="action" value="refund_sent" />
                        <input type="hidden" name="back" value="/desk/payments?tab=refunds" />
                        <input type="hidden" name="refund" value={row.refund.id} />
                        <label className="block min-w-0 flex-1 lg:w-56">
                          <span className="field-label">M-Pesa reference</span>
                          <input name="reference" required maxLength={40} className="field tabular min-h-10 py-2" />
                        </label>
                        <button type="submit" className="button button-night min-h-10 shrink-0 px-4 py-2 text-sm">
                          Record as sent
                        </button>
                      </form>
                    ) : (
                      <p className="text-sm text-ink-faint">A manager records it once it is sent.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Sent lately" count={refunds.sent.length}>
            {refunds.sent.length === 0 ? (
              <Empty>No refund has been sent yet.</Empty>
            ) : (
              <ul className="divide-y divide-rule">
                {refunds.sent.map((row) => (
                  <li
                    key={row.refund.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0">
                      <a
                        href={`/desk/bookings/${row.bookingId}`}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        {guest(row)}
                      </a>
                      <p className="tabular text-sm text-ink-faint">
                        {row.reference} · {row.refund.reference ?? "no reference"} ·{" "}
                        {row.refund.sentAt ? formatMoment(row.refund.sentAt) : ""}
                        {row.sentBy ? ` · ${row.sentBy}` : ""}
                      </p>
                    </div>
                    <span className="amount font-medium">{formatMoney(row.refund.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}
    </DeskPage>
  );
}

function PaymentChip({ status }: { status: "pending" | "paid" | "failed" }) {
  return status === "paid" ? (
    <Chip label="Paid" tone="paid" />
  ) : status === "pending" ? (
    <Chip label="Waiting" tone="wait" />
  ) : (
    <Chip label="Did not go through" tone="bad" />
  );
}

function BalanceList({
  title,
  rows,
  empty,
  name,
  line,
  late = false,
}: {
  title: string;
  rows: Balance[];
  empty: string;
  name: (row: { guestName: string; sample: boolean }) => string;
  line: (row: Balance) => string;
  late?: boolean;
}) {
  const total = rows.reduce((sum, row) => sum + row.money.owedCents, 0);
  return (
    <Panel
      title={title}
      count={rows.length}
      action={rows.length ? <span className="amount text-sm text-ink-faint">{formatMoney(total)} in all</span> : null}
    >
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((row) => (
            <li
              key={row.booking.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
            >
              <div className="min-w-0">
                <a
                  href={`/desk/bookings/${row.booking.id}`}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  {name({ guestName: row.booking.guestName, sample: row.booking.sample })}
                </a>
                <p className="text-sm text-ink-faint">
                  {line(row)} · <span className="tabular">{row.booking.reference}</span>
                </p>
              </div>
              <span className={`amount font-semibold ${late ? "text-heath-700" : ""}`}>
                {formatMoney(row.money.owedCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
