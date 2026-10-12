import type { Metadata } from "next";
import { connection } from "next/server";

import { Door } from "@/components/desk/door";
import { readFlash } from "@/server/flash";

export const metadata: Metadata = {
  title: "Forgot your password",
  robots: { index: false, follow: false },
};

export default async function ForgotPage({ searchParams }: PageProps<"/desk/forgot">) {
  await connection();
  const query = await searchParams;

  return (
    <Door title="Forgot your password?" problem={readFlash(query.oops)} note={readFlash(query.note)}>
      <p className="mt-3 text-ink-soft">
        Enter the email address you sign in with, and we will send a link to choose a new one.
      </p>
      <form action="/desk/forgot/send" method="post" className="mt-5 space-y-4">
        <label className="block">
          <span className="field-label">Email</span>
          <input name="email" type="email" required autoComplete="username" autoFocus className="field" />
        </label>
        <button type="submit" className="button button-night w-full">
          Send me the link
        </button>
      </form>
      <p className="mt-5 text-center text-sm">
        <a href="/desk/sign-in" className="link">
          Back to signing in
        </a>
      </p>
    </Door>
  );
}
