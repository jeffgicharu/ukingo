import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { Door } from "@/components/desk/door";
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

  return (
    <Door title="Sign in" problem={readFlash(query.oops)} note={readFlash(query.note)}>
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
    </Door>
  );
}
