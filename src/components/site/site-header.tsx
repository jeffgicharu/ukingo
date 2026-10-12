import { Logo } from "./logo";

const links = [
  { href: "/rooms", label: "Rooms" },
  { href: "/experiences", label: "Experiences" },
  { href: "/getting-here", label: "Getting here" },
  { href: "/questions", label: "Questions" },
];

/**
 * `over` puts the header on top of a dark photograph, with light text. Every
 * other page gets the plain header on the pale ground.
 */
export function SiteHeader({ over = false }: { over?: boolean }) {
  const tone = over ? "text-mist-50" : "text-ink";

  return (
    <header className={over ? "absolute inset-x-0 top-0 z-30" : "relative z-30 border-b border-rule bg-mist-50"}>
      <div className={`wrap flex h-18 items-center justify-between gap-4 md:h-20 ${tone}`}>
        <a href="/" aria-label="Ukingo, home" className="shrink-0">
          <Logo />
        </a>

        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[0.95rem] font-medium underline-offset-8 decoration-ember-500 decoration-2 hover:underline"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a href="/stay" className="button button-ember min-h-11 px-4 text-sm sm:px-5">
            Check dates
          </a>

          {/* Works without script: the browser opens and closes it. */}
          <details className="group relative lg:hidden">
            <summary
              className={`flex size-11 cursor-pointer list-none items-center justify-center rounded-full border [&::-webkit-details-marker]:hidden ${
                over ? "border-rule-light" : "border-rule"
              }`}
            >
              <span className="sr-only">Menu</span>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
                className="size-5"
              >
                <path d="M3 6.5h14M3 13.5h14" className="group-open:hidden" />
                <path d="M5 5l10 10M15 5L5 15" className="hidden group-open:block" />
              </svg>
            </summary>
            <nav
              aria-label="Main"
              className="absolute right-0 top-13 w-64 max-w-[calc(100vw-2.5rem)] rounded-xl border border-rule bg-mist-50 p-2 text-ink shadow-lift"
            >
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="block rounded-lg px-4 py-3 font-medium hover:bg-mist-100"
                >
                  {link.label}
                </a>
              ))}
              <a
                href="/find-booking"
                className="mt-1 block rounded-lg border-t border-rule px-4 py-3 font-medium hover:bg-mist-100"
              >
                Find my booking
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
