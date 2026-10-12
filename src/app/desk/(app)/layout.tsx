import type { Metadata } from "next";
import { connection } from "next/server";

import { DeskNav, DeskPulse, type NavGroup } from "@/components/desk/nav";
import { Mark } from "@/components/site/logo";
import { deskPulse } from "@/server/desk/board";
import { maySee, ROLE_NAMES, type Staff } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = {
  title: { default: "Front desk", template: "%s · Ukingo front desk" },
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

function menuFor(staff: Staff): NavGroup[] {
  const setup = [
    maySee(staff, "rates.edit") ? { href: "/desk/rooms", label: "Rooms and prices" } : null,
    maySee(staff, "rules.edit") ? { href: "/desk/rules", label: "Booking rules" } : null,
    maySee(staff, "content.edit") ? { href: "/desk/pages", label: "Pages" } : null,
    maySee(staff, "staff.manage") ? { href: "/desk/staff", label: "Staff" } : null,
    maySee(staff, "settings.edit") ? { href: "/desk/settings", label: "Settings" } : null,
  ].filter((item) => item !== null);

  return [
    {
      items: [
        { href: "/desk", label: "Today" },
        { href: "/desk/calendar", label: "Calendar" },
        { href: "/desk/bookings", label: "Bookings" },
        { href: "/desk/payments", label: "Payments" },
        { href: "/desk/guests", label: "Guests" },
        { href: "/desk/messages", label: "Messages" },
      ],
    },
    ...(setup.length ? [{ heading: "Setup", items: setup }] : []),
  ];
}

export default async function DeskLayout({ children }: LayoutProps<"/desk">) {
  await connection();
  const staff = await requireStaff();
  const menu = menuFor(staff);
  const pulse = await deskPulse();

  const account = (
    <div className="text-sm">
      <p className="font-semibold">{staff.name}</p>
      <p className="opacity-70">
        {ROLE_NAMES[staff.role]}
        {staff.training ? " · Training" : ""}
      </p>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-mist-100 lg:flex-row">
      <DeskPulse initial={pulse} />

      {/* On a laptop the menu is a column that stays put. */}
      <aside className="hidden w-60 shrink-0 flex-col bg-night-900 text-mist-50 lg:flex">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto p-4">
          <a href="/desk" className="flex items-center gap-2.5 px-2 pt-1">
            <Mark className="size-7" />
            <span>
              <span className="font-display block text-2xl leading-none">Ukingo</span>
              <span className="label mt-1 block text-night-400">Front desk</span>
            </span>
          </a>
          <div className="flex-1">
            <DeskNav groups={menu} />
          </div>
          <div className="space-y-3 border-t border-rule-light px-2 pt-4">
            {account}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a href="/desk/account" className="text-night-200 underline-offset-4 hover:text-mist-50 hover:underline">
                My account
              </a>
              <form action="/desk/sign-out" method="post">
                <button type="submit" className="text-night-200 underline-offset-4 hover:text-mist-50 hover:underline">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      {/* On a phone it folds into a bar across the top. */}
      <header className="sticky top-0 z-40 bg-night-900 text-mist-50 lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <a href="/desk" className="flex items-center gap-2">
            <Mark className="size-6" />
            <span className="font-display text-xl leading-none">Ukingo</span>
            <span className="label text-night-400">Front desk</span>
          </a>
          <details className="group relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-rule-light px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <div className="absolute right-0 top-12 max-h-[calc(100dvh-5rem)] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-rule bg-white p-3 text-ink shadow-lift">
              <DeskNav groups={menu} onDark={false} />
              <div className="mt-4 space-y-2 border-t border-rule px-3 pt-3">
                {account}
                <div className="flex gap-4 text-sm">
                  <a href="/desk/account" className="link">
                    My account
                  </a>
                  <form action="/desk/sign-out" method="post">
                    <button type="submit" className="link">
                      Sign out
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </details>
        </div>
      </header>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
