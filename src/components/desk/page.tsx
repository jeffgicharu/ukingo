import type { ReactNode } from "react";

import { readFlash } from "@/server/flash";

type Query = Record<string, string | string[] | undefined>;

/** The frame of every back-office screen: a title, what can be done here, and what just happened. */
export function DeskPage({
  title,
  summary,
  actions,
  query,
  wide = false,
  children,
}: {
  title: string;
  summary?: ReactNode;
  actions?: ReactNode;
  /** The page's address parameters, for the message left by the last step. */
  query?: Query;
  /** Tables and the calendar use the full width. Forms and single records read better narrower. */
  wide?: boolean;
  children: ReactNode;
}) {
  const note = query ? readFlash(query.note) : null;
  const oops = query ? readFlash(query.oops) : null;

  return (
    <main
      id="main"
      className={`mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${wide ? "max-w-[100rem]" : "max-w-6xl"}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="display text-4xl md:text-5xl">{title}</h1>
          {summary ? <p className="mt-1.5 text-ink-soft">{summary}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      {note ? (
        <p role="status" className="mt-5 rounded-xl border border-moss-600/30 bg-moss-100 px-4 py-3 text-moss-700">
          {note}
        </p>
      ) : null}
      {oops ? (
        <p role="alert" className="mt-5 rounded-xl border border-heath-600/30 bg-heath-100 px-4 py-3 text-heath-700">
          {oops}
        </p>
      ) : null}
      {query?.refused ? (
        <p role="alert" className="mt-5 rounded-xl border border-heath-600/30 bg-heath-100 px-4 py-3 text-heath-700">
          Your role does not include that screen.
        </p>
      ) : null}

      <div className="mt-6">{children}</div>
    </main>
  );
}

/** A white panel with a heading: the unit every screen is built from. */
export function Panel({
  title,
  count,
  action,
  children,
  className = "",
}: {
  title?: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-rule bg-white shadow-panel ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3 sm:px-5">
          <h2 className="font-semibold">
            {title}
            {count !== undefined ? <span className="tabular ml-2 font-normal text-ink-faint">{count}</span> : null}
          </h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** What a list says when it has nothing in it. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-ink-faint sm:px-5">{children}</p>;
}

/** One small form holding one button: a step taken on a booking. */
export function StepButton({
  bookingId,
  action,
  back,
  label,
  tone = "night",
  fields,
}: {
  bookingId: number;
  action: string;
  back: string;
  label: string;
  tone?: "night" | "ember" | "line";
  fields?: Record<string, string | number>;
}) {
  const tones = { night: "button-night", ember: "button-ember", line: "button-line" };
  return (
    <form action={`/desk/bookings/${bookingId}/act`} method="post">
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="back" value={back} />
      {Object.entries(fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={`button ${tones[tone]} min-h-9 px-4 py-1.5 text-sm`}>
        {label}
      </button>
    </form>
  );
}
