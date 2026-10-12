import { connection } from "next/server";

import { SiteFooter } from "@/components/site/site-footer";
import { lodgeDay } from "@/lib/dates";
import { clock } from "@/server/clock";

export default async function SiteLayout({ children }: LayoutProps<"/">) {
  await connection();
  const year = Number(lodgeDay(clock.now()).slice(0, 4));

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ember-500 focus:px-4 focus:py-2 focus:font-semibold focus:text-night-950"
      >
        Skip to the page
      </a>
      {children}
      <SiteFooter year={year} />
    </>
  );
}
