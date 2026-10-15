"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A submit button for work that takes a few seconds. Once its form is sent it
 * says the work has started, and a second press does nothing. Without script
 * it is an ordinary button.
 */
export function BusyButton({ children, busy, className }: { children: ReactNode; busy: string; className: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const form = button.current?.form;
    if (!form) return;
    const start = () => setSent(true);
    // Coming back to this page from the browser's history shows it ready again.
    const again = (event: PageTransitionEvent) => event.persisted && setSent(false);
    form.addEventListener("submit", start);
    window.addEventListener("pageshow", again);
    return () => {
      form.removeEventListener("submit", start);
      window.removeEventListener("pageshow", again);
    };
  }, []);

  return (
    <button
      ref={button}
      type="submit"
      aria-disabled={sent || undefined}
      onClick={(event) => {
        if (sent) event.preventDefault();
      }}
      className={`${className} ${sent ? "cursor-progress opacity-70" : ""}`}
    >
      <span aria-live="polite">{sent ? busy : children}</span>
    </button>
  );
}
