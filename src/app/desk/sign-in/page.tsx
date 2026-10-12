import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { Mark } from "@/components/site/logo";
import { readFlash } from "@/server/flash";
import { currentStaff } from "@/server/staff/sessions";

export const metadata: Metadata = {
  title: "Sign in to the front desk",
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: PageProps<"/desk/sign-in">) {
  await connection();
  if (await currentStaff()) redirect("/desk");

  const query = await searchParams;
  const problem = readFlash(query.oops);
  const note = readFlash(query.note);

  return (
    <main className="contours flex min-h-dvh flex-col items-center justify-center bg-night-900 px-5 py-12">
      <div className="w-full max-w-sm">
        <p className="flex items-center justify-center gap-3 text-mist-50">
          <Mark className="size-9" />
          <span className="font-display text-4xl leading-none">Ukingo</span>
        </p>
        <p className="label mt-3 text-center text-night-300">Front desk</p>

        <div className="mt-8 rounded-2xl bg-mist-50 p-6 shadow-lift sm:p-8">
          <h1 className="display text-3xl">Sign in</h1>

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

          <form action="/desk/sign-in/send" method="post" className="mt-5 space-y-4">
            <label className="block">
              <span className="field-label">Email</span>
              <input name="email" type="email" required autoComplete="username" autoFocus className="field" />
            </label>
            <label className="block">
              <span className="field-label">Password</span>
              <input name="password" type="password" required autoComplete="current-password" className="field" />
            </label>
            <button type="submit" className="button button-night w-full">
              Sign in
            </button>
          </form>

          <p className="mt-5 text-center text-sm">
            <a href="/desk/forgot" className="link">
              Forgot your password?
            </a>
          </p>
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
