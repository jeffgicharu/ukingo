import type { Metadata } from "next";
import Link from "next/link";

import { DawnScene } from "@/components/site/dawn-scene";
import { Logo } from "@/components/site/logo";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      id="main"
      className="relative isolate flex min-h-dvh flex-1 flex-col overflow-hidden bg-night-900 text-mist-50"
    >
      <div className="absolute inset-0 -z-10">
        <DawnScene />
      </div>
      <div className="absolute inset-0 -z-10 bg-night-950/40" />

      <div className="wrap flex h-18 items-center md:h-20">
        <Link href="/" aria-label="Ukingo, home">
          <Logo />
        </Link>
      </div>

      <div className="wrap flex flex-1 flex-col justify-center pb-24">
        <p className="label text-ember-300">Page not found</p>
        <h1 className="display mt-4 max-w-[13ch] text-6xl md:text-7xl">You have walked off the path.</h1>
        <p className="mt-5 max-w-md text-lg text-mist-100">
          There is nothing at this address. It may have moved, or the link may have been mistyped.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className="button button-ember">
            Back to the lodge
          </Link>
          <Link href="/rooms" className="button button-line-light">
            See the rooms
          </Link>
          <Link href="/find-booking" className="button button-line-light">
            Find my booking
          </Link>
        </div>
      </div>
    </main>
  );
}
