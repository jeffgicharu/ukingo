"use client";

import { useEffect, useRef } from "react";

const KEY = "ukingo:your-details";
const FIELDS = ["name", "phone", "email", "arrival", "requests"];

type Typed = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * Keeps what a guest typed into the form it sits in, so that if the form
 * comes back with a correction they do not type it all again. It stays on
 * their own device, in this tab only, and is dropped when the form is next
 * opened fresh.
 */
export function KeepTyped({ restore }: { restore: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = marker.current?.closest("form");
    if (!form) return;
    const fieldNamed = (name: string) => form.elements.namedItem(name) as Typed | null;

    try {
      const kept = restore ? window.sessionStorage.getItem(KEY) : null;
      if (kept) {
        const values = JSON.parse(kept) as Record<string, string>;
        for (const name of FIELDS) {
          const input = fieldNamed(name);
          if (input && input.value === "" && typeof values[name] === "string") input.value = values[name];
        }
      } else {
        window.sessionStorage.removeItem(KEY);
      }
    } catch {
      // Private windows can refuse storage. The form works the same without it.
    }

    const keep = () => {
      try {
        const values = Object.fromEntries(FIELDS.map((name) => [name, fieldNamed(name)?.value ?? ""]));
        window.sessionStorage.setItem(KEY, JSON.stringify(values));
      } catch {
        // Nothing is kept, and the guest types it again.
      }
    };
    form.addEventListener("submit", keep);
    return () => form.removeEventListener("submit", keep);
  }, [restore]);

  return <span ref={marker} hidden />;
}
