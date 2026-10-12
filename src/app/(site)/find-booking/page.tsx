import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { PageHeading } from "@/components/site/page-heading";
import { SiteHeader } from "@/components/site/site-header";
import { privatePage } from "@/lib/metadata";

export const metadata: Metadata = { ...privatePage("Find my booking"), alternates: { canonical: "/find-booking" } };

export default async function FindBookingPage({ searchParams }: PageProps<"/find-booking">) {
  await connection();
  const query = await searchParams;
  const sent = typeof query.sent === "string";
  const problem = typeof query.problem === "string";

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <PageHeading
          label="Your booking"
          title="Find my booking"
          summary="Lost the email with your link? Enter your booking reference and the email address you booked with, and we will send the link again."
        />

        <div className="wrap py-14">
          <div className="max-w-2xl">
            {sent ? (
              <div role="status" className="rounded-2xl border border-moss-600/30 bg-moss-100 p-6">
                <h2 className="display text-2xl text-moss-700">Check your email</h2>
                <p className="mt-2">
                  If those details match a booking, the link is on its way to that address. It usually arrives within a
                  minute. Look in your spam folder too.
                </p>
              </div>
            ) : null}
            {problem ? (
              <div role="alert" className="rounded-2xl border border-heath-600/30 bg-heath-100 p-6">
                <p>
                  Enter the booking reference from your confirmation, such as UKG-7Q4MXR, and the email address you
                  booked with.
                </p>
              </div>
            ) : null}

            <form action="/find-booking/send" method="post" className={`space-y-5 ${sent || problem ? "mt-8" : ""}`}>
              <div>
                <label htmlFor="find-reference" className="field-label">
                  Booking reference
                </label>
                <input
                  id="find-reference"
                  name="reference"
                  type="text"
                  required
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="UKG-7Q4MXR"
                  className="field tabular max-w-xs uppercase placeholder:normal-case"
                />
              </div>
              <div>
                <label htmlFor="find-email" className="field-label">
                  Email address
                </label>
                <input
                  id="find-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="field max-w-md"
                />
              </div>
              <button type="submit" className="button button-night">
                Send me the link
              </button>
            </form>

            <p className="mt-10 text-sm text-ink-faint">
              For your privacy, the link is only ever sent to the address on the booking. If you booked without an email
              address, ask at the front desk when you arrive. See also our{" "}
              <Link href="/questions" className="link">
                questions
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
