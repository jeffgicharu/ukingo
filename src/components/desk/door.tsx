import type { ReactNode } from "react";

import { Mark } from "@/components/site/logo";

/** The page a member of staff meets before they are signed in: signing in, or getting back in. */
export function Door({
  title,
  problem,
  note,
  children,
}: {
  title: string;
  /** Something that went wrong with the last try. */
  problem?: string | null;
  /** Something that went right. */
  note?: string | null;
  children: ReactNode;
}) {
  return (
    <main className="contours flex min-h-dvh flex-col items-center justify-center bg-night-900 px-5 py-12">
      <div className="w-full max-w-sm">
        <p className="flex items-center justify-center gap-3 text-mist-50">
          <Mark className="size-9" />
          <span className="font-display text-4xl leading-none">Ukingo</span>
        </p>
        <p className="label mt-3 text-center text-night-300">Front desk</p>

        <div className="mt-8 rounded-2xl bg-mist-50 p-6 shadow-lift sm:p-8">
          <h1 className="display text-3xl">{title}</h1>

          {problem ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-heath-600/30 bg-heath-100 px-4 py-3 text-sm text-heath-700"
            >
              {problem}
            </p>
          ) : null}
          {note ? (
            <p
              role="status"
              className="mt-4 rounded-lg border border-moss-600/30 bg-moss-100 px-4 py-3 text-sm text-moss-700"
            >
              {note}
            </p>
          ) : null}

          {children}
        </div>

        <p className="mt-6 text-center text-sm text-night-300">
          <a href="/" className="underline-offset-4 hover:text-mist-50 hover:underline">
            Back to the lodge&apos;s site
          </a>
        </p>
      </div>
    </main>
  );
}
