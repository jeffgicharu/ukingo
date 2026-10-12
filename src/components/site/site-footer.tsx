import { Logo } from "./logo";

const columns = [
  {
    heading: "Stay",
    links: [
      { href: "/rooms", label: "Rooms" },
      { href: "/experiences", label: "Experiences" },
      { href: "/stay", label: "Check dates" },
      { href: "/find-booking", label: "Find my booking" },
    ],
  },
  {
    heading: "Plan",
    links: [
      { href: "/getting-here", label: "Getting here" },
      { href: "/questions", label: "Questions" },
      { href: "/booking-terms", label: "Booking and cancellation" },
    ],
  },
  {
    heading: "Ukingo",
    links: [
      { href: "/about", label: "About" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms of use" },
    ],
  },
];

export function SiteFooter({ year }: { year: number }) {
  return (
    <footer className="contours bg-night-900 text-mist-50">
      <div className="wrap grid gap-12 py-16 md:grid-cols-[1.4fr_2fr] md:py-20">
        <div>
          <Logo />
          <p className="mt-5 max-w-xs text-night-200">
            A small lodge on the edge of the Mount Kenya forest, 14 km from Nanyuki.
          </p>
          <p className="label mt-8 text-night-300">2,180 m · On the equator</p>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
          {columns.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="label text-night-300">{column.heading}</h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="text-mist-100 underline-offset-4 hover:text-ember-300 hover:underline"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className="border-t border-rule-light">
        <div className="wrap flex flex-col gap-2 py-6 text-sm text-night-300 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Ukingo. Nanyuki, Kenya.</p>
          <p>Prices in Kenya shillings, taxes included.</p>
        </div>
      </div>
    </footer>
  );
}
