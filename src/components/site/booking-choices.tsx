"use client";

import { type ReactNode, useState } from "react";

import { formatDay, formatMoney, plural } from "@/lib/format";
import { percentOf } from "@/lib/money";

export type ChoicePlan = { code: string; name: string; description: string; cents: number };
export type ChoiceExtra = { id: number; name: string; duration: string; cents: number; note: string };

type Props = {
  roomName: string;
  nights: { night: string; cents: number; season: string }[];
  plans: ChoicePlan[];
  extras: ChoiceExtra[];
  initialPlan: string;
  initialExtras: number[];
  /** The share paid today. 100 when the stay is too close for a deposit. */
  depositPercent: number;
  /** "Friday 30 October 2026", or null when everything is paid today. */
  balanceDue: string | null;
  /** The cancellation terms as a sentence or two of real dates. */
  cancellation: string;
  holdMinutes: number;
  /** The rest of the form: the guest's own details. Shown under the choices. */
  children: ReactNode;
};

/**
 * The meal plan, the extras and the bill beside them. The bill adds itself
 * up as choices are made. Without script the choices still go in with the
 * form, and the next page shows the full bill before anything is paid.
 */
export function BookingChoices(props: Props) {
  const [plan, setPlan] = useState(props.initialPlan);
  const [chosen, setChosen] = useState<number[]>(props.initialExtras);

  const roomCents = props.nights.reduce((sum, night) => sum + night.cents, 0);
  const planChoice = props.plans.find((entry) => entry.code === plan) ?? props.plans[0];
  const extras = props.extras.filter((extra) => chosen.includes(extra.id));
  const totalCents = roomCents + planChoice.cents + extras.reduce((sum, extra) => sum + extra.cents, 0);
  const todayCents = props.depositPercent >= 100 ? totalCents : percentOf(totalCents, props.depositPercent);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-x-14">
      <div className="space-y-10">
        <fieldset>
          <legend className="display text-3xl">Meals</legend>
          <p className="mt-1 text-ink-soft">Breakfast is always included.</p>
          <div className="mt-5 space-y-3">
            {props.plans.map((entry) => (
              <label
                key={entry.code}
                className="flex cursor-pointer items-start gap-4 rounded-xl border border-mist-300 bg-white p-4 transition-colors has-checked:border-night-700 has-checked:bg-mist-100 hover:border-night-400"
              >
                <input
                  type="radio"
                  name="meals"
                  value={entry.code}
                  checked={plan === entry.code}
                  onChange={() => setPlan(entry.code)}
                  className="mt-1 size-5 shrink-0 accent-night-900"
                />
                <span className="grid flex-1 gap-x-4 gap-y-0.5 sm:grid-cols-[1fr_auto]">
                  <span className="font-semibold">{entry.name}</span>
                  <span className="tabular sm:text-right">
                    {entry.cents === 0 ? "Included" : `+ ${formatMoney(entry.cents)}`}
                  </span>
                  <span className="text-sm text-ink-faint sm:col-span-2">{entry.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {props.extras.length ? (
          <fieldset>
            <legend className="display text-3xl">Add to your stay</legend>
            <p className="mt-1 text-ink-soft">Optional. We arrange the day and time with you when you arrive.</p>
            <div className="mt-5 space-y-3">
              {props.extras.map((extra) => (
                <label
                  key={extra.id}
                  className="flex cursor-pointer items-start gap-4 rounded-xl border border-mist-300 bg-white p-4 transition-colors has-checked:border-night-700 has-checked:bg-mist-100 hover:border-night-400"
                >
                  <input
                    type="checkbox"
                    name="extra"
                    value={extra.id}
                    checked={chosen.includes(extra.id)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked ? [...current, extra.id] : current.filter((id) => id !== extra.id),
                      )
                    }
                    className="mt-1 size-5 shrink-0 accent-night-900"
                  />
                  <span className="grid flex-1 gap-x-4 gap-y-0.5 sm:grid-cols-[1fr_auto]">
                    <span className="font-semibold">{extra.name}</span>
                    <span className="tabular sm:text-right">+ {formatMoney(extra.cents)}</span>
                    <span className="text-sm text-ink-faint sm:col-span-2">
                      {extra.duration} · {extra.note}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>

      {/* In the page the bill comes before the guest's details, so on a phone it is read before the button. */}
      <aside aria-label="Your bill" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="rounded-2xl bg-night-900 p-6 text-mist-50 lg:sticky lg:top-6">
          <h2 className="display text-3xl">Your bill</h2>

          <table className="tabular mt-4 w-full text-[0.95rem]">
            <tbody>
              {props.nights.map((night) => (
                <tr key={night.night} className="border-b border-rule-light">
                  <th scope="row" className="py-2 text-left font-normal text-night-200">
                    {formatDay(night.night, "compact")}
                  </th>
                  <td className="py-2 text-right">{formatMoney(night.cents)}</td>
                </tr>
              ))}
              {planChoice.cents > 0 ? (
                <tr className="border-b border-rule-light">
                  <th scope="row" className="py-2 text-left font-normal text-night-200">
                    {planChoice.name}
                  </th>
                  <td className="py-2 text-right">{formatMoney(planChoice.cents)}</td>
                </tr>
              ) : null}
              {extras.map((extra) => (
                <tr key={extra.id} className="border-b border-rule-light">
                  <th scope="row" className="py-2 text-left font-normal text-night-200">
                    {extra.name}
                  </th>
                  <td className="py-2 text-right">{formatMoney(extra.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-4 flex items-baseline justify-between gap-4">
            <span className="label text-night-300">Total</span>
            <span className="display tabular text-4xl" aria-live="polite">
              {formatMoney(totalCents)}
            </span>
          </p>
          <p className="mt-1 text-right text-sm text-night-300">
            {props.roomName}, {plural(props.nights.length, "night")}, taxes included
          </p>

          <dl className="mt-6 space-y-3 border-t border-rule-light pt-5 text-[0.95rem]">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-night-200">
                {props.depositPercent >= 100 ? "To pay today" : `Deposit today (${props.depositPercent}%)`}
              </dt>
              <dd className="tabular font-semibold whitespace-nowrap text-ember-300">{formatMoney(todayCents)}</dd>
            </div>
            {props.balanceDue && totalCents - todayCents > 0 ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-night-200">Balance by {props.balanceDue}</dt>
                <dd className="tabular whitespace-nowrap">{formatMoney(totalCents - todayCents)}</dd>
              </div>
            ) : null}
          </dl>

          <p className="mt-5 text-sm text-night-300">{props.cancellation}</p>
          <p className="mt-3 text-sm text-night-300">
            The room is held for {plural(props.holdMinutes, "minute")} while you pay.
          </p>
        </div>
      </aside>

      <div className="space-y-10 lg:col-start-1">{props.children}</div>
    </div>
  );
}
