"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export type NavItem = { href: string; label: string };
export type NavGroup = { heading?: string; items: NavItem[] };

function isCurrent(pathname: string, href: string): boolean {
  return href === "/desk" ? pathname === "/desk" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The back office's menu. The page being shown is marked. */
export function DeskNav({ groups, onDark = true }: { groups: NavGroup[]; onDark?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Back office" className="space-y-6">
      {groups.map((group, index) => (
        <div key={group.heading ?? index}>
          {group.heading ? (
            <p className={`label mb-2 px-3 ${onDark ? "text-night-400" : "text-ink-faint"}`}>{group.heading}</p>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const current = isCurrent(pathname, item.href);
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={`block rounded-lg px-3 py-2 text-[0.95rem] font-medium transition-colors ${
                      onDark
                        ? current
                          ? "bg-night-700 text-mist-50"
                          : "text-night-200 hover:bg-night-800 hover:text-mist-50"
                        : current
                          ? "bg-mist-200 text-ink"
                          : "text-ink-soft hover:bg-mist-100 hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Keeps a staff screen current. It asks the server every few seconds whether
 * anything has changed and, when it has, has the page fetch its content again.
 * Nothing is asked while the tab is in the background.
 */
export function DeskPulse({ initial }: { initial: number }) {
  const router = useRouter();
  const seen = useRef(initial);

  useEffect(() => {
    let stopped = false;
    let timer: number;

    const ask = async () => {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/desk/pulse", { cache: "no-store", headers: { Accept: "application/json" } });
          if (response.status === 401) {
            // The session has ended. A whole-page load drops everything this tab was holding.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/desk/sign-in");
            return;
          }
          if (response.ok) {
            const { pulse } = (await response.json()) as { pulse: number };
            if (pulse !== seen.current) {
              seen.current = pulse;
              router.refresh();
            }
          }
        } catch {
          // Offline for a moment. The next ask will catch up.
        }
      }
      if (!stopped) timer = window.setTimeout(ask, 5000);
    };

    timer = window.setTimeout(ask, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer);
        void ask();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
