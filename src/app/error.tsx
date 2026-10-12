"use client";

import Link from "next/link";

import { Logo } from "@/components/site/logo";

// Shown when a page fails while it is being built. The fault itself is
// reported on the server, where the team can see it. The visitor gets a plain
// apology and a way on.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main" className="contours flex min-h-dvh flex-1 flex-col bg-night-900 text-mist-50">
      <div className="wrap flex h-18 items-center md:h-20">
        <Link href="/" aria-label="Ukingo, home">
          <Logo />
        </Link>
      </div>

      <div className="wrap flex flex-1 flex-col justify-center pb-24">
        <p className="label text-ember-300">Something went wrong</p>
        <h1 className="display mt-4 max-w-[14ch] text-6xl md:text-7xl">That did not work. It is us, not you.</h1>
        <p className="mt-5 max-w-md text-lg text-mist-100">
          The page could not be shown. Nothing you entered has been lost or charged. Please try again in a moment.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={() => retry()} className="button button-ember">
            Try again
          </button>
          <Link href="/" className="button button-line-light">
            Back to the lodge
          </Link>
        </div>
        {error.digest ? <p className="label mt-10 text-night-400">Reference {error.digest}</p> : null}
      </div>
    </main>
  );
}
