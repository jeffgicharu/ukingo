import { formatDay, formatMoment, formatMoney, plural, unbroken } from "@/lib/format";
import type { BookingView } from "@/server/booking/view";

/** The stay in a few labelled lines. */
export function StayFacts({
  view,
  checkInFrom,
  checkOutBy,
}: {
  view: BookingView;
  checkInFrom: string;
  checkOutBy: string;
}) {
  const { booking } = view;
  const rows: [string, string][] = [
    ["Room", view.roomType.name],
    ["Arrive", `${formatDay(booking.stay.from, "long")}, from ${unbroken(checkInFrom)}`],
    ["Leave", `${formatDay(booking.stay.to, "long")}, by ${unbroken(checkOutBy)}`],
    ["Nights", String(view.nights.length)],
    [
      "Guests",
      `${plural(booking.adults, "adult")}${booking.children ? `, ${plural(booking.children, "child", "children")}` : ""}`,
    ],
    ["Meals", view.mealPlan.name],
  ];
  if (booking.arrivalTime) rows.push(["Arriving", booking.arrivalTime]);

  return (
    <dl className="border-t border-rule">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[6.5rem_1fr] gap-4 border-b border-rule py-3">
          <dt className="label pt-1 text-ink-faint">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The bill, night by night, with everything added to it. */
export function Bill({ view }: { view: BookingView }) {
  return (
    <table className="tabular w-full">
      <tbody>
        {view.nights.map((night) => (
          <tr key={night.night} className="border-b border-rule">
            <th scope="row" className="py-2.5 text-left font-normal text-ink-soft">
              {formatDay(night.night, "compact")}
            </th>
            <td className="py-2.5 text-right whitespace-nowrap">{formatMoney(night.cents)}</td>
          </tr>
        ))}
        {view.charges.map((charge) => (
          <tr key={charge.id} className="border-b border-rule">
            <th scope="row" className="py-2.5 pr-4 text-left font-normal text-ink-soft">
              {charge.label}
            </th>
            <td className="py-2.5 text-right whitespace-nowrap">{formatMoney(charge.cents)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className="pt-4 text-left">
            <span className="label text-ink-faint">Total</span>
          </th>
          <td className="display pt-3 text-right text-3xl whitespace-nowrap">{formatMoney(view.money.totalCents)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

const methods: Record<string, string> = {
  mpesa_prompt: "M-Pesa",
  mpesa_desk: "M-Pesa at the desk",
  test: "Test payment",
  cash: "Cash",
  bank: "Bank transfer",
};

export function methodName(method: string): string {
  return methods[method] ?? method;
}

/** Money in and money back, in the order it happened. Unanswered and failed prompts are left out. */
export function Payments({ view }: { view: BookingView }) {
  const paid = view.payments.filter((payment) => payment.status === "paid");
  if (paid.length === 0 && view.refunds.length === 0) return null;

  return (
    <ul className="border-t border-rule">
      {paid.map((payment) => (
        <li key={`p${payment.id}`} className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-rule py-3">
          <span>
            {methodName(payment.method)}
            {payment.receipt ? <span className="tabular text-ink-faint"> · {payment.receipt}</span> : null}
          </span>
          <span className="tabular text-right font-medium">{formatMoney(payment.cents)}</span>
          <span className="text-sm text-ink-faint">{payment.settledAt ? formatMoment(payment.settledAt) : ""}</span>
        </li>
      ))}
      {view.refunds.map((refund) => (
        <li key={`r${refund.id}`} className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-rule py-3">
          <span>
            {refund.status === "sent" ? "Refund sent" : "Refund on its way"}
            {refund.reference ? <span className="tabular text-ink-faint"> · {refund.reference}</span> : null}
          </span>
          <span className="tabular text-right font-medium">− {formatMoney(refund.cents)}</span>
          <span className="text-sm text-ink-faint">
            {refund.status === "sent" && refund.sentAt
              ? formatMoment(refund.sentAt)
              : "To the M-Pesa number that paid, within 3 working days"}
          </span>
        </li>
      ))}
    </ul>
  );
}
