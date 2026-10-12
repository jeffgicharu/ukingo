import type { Metadata } from "next";
import { connection } from "next/server";

import { Door } from "@/components/desk/door";
import { clock } from "@/server/clock";
import { readFlash } from "@/server/flash";
import { resetIsGood } from "@/server/staff/manage";
import { MIN_PASSWORD_LENGTH } from "@/server/staff/passwords";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
  // The address of this page is the key to the account. It is told to no other site.
  referrer: "no-referrer",
};

export default async function ResetPage({ params, searchParams }: PageProps<"/desk/reset/[token]">) {
  await connection();
  const { token } = await params;
  const query = await searchParams;
  const good = await resetIsGood(token, clock.now());

  return (
    <Door title="Choose a new password" problem={readFlash(query.oops)}>
      {good ? (
        <form action={`/desk/reset/${token}/send`} method="post" className="mt-5 space-y-4">
          <label className="block">
            <span className="field-label">New password</span>
            <input
              name="password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              autoFocus
              className="field"
            />
            <span className="mt-1.5 block text-sm text-ink-faint">At least {MIN_PASSWORD_LENGTH} characters.</span>
          </label>
          <label className="block">
            <span className="field-label">The same again</span>
            <input name="again" type="password" required autoComplete="new-password" className="field" />
          </label>
          <button type="submit" className="button button-night w-full">
            Save the new password
          </button>
        </form>
      ) : (
        <>
          <p className="mt-3 text-ink-soft">This link has been used or has run out. A link is good for one hour.</p>
          <a href="/desk/forgot" className="button button-night mt-5 w-full">
            Ask for a new link
          </a>
        </>
      )}
    </Door>
  );
}
