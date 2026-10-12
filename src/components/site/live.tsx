"use client";

import { useEffect, useState } from "react";

/**
 * Counts down to the moment a held room is let go. When it reaches zero the
 * page is loaded again, so the guest sees what the server now says.
 */
export function HoldCountdown({ until, label }: { until: string; label: string }) {
  const end = new Date(until).getTime();
  // Until the page's script is running, the plain sentence is shown.
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(seconds);
      if (seconds === 0) {
        window.location.reload();
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [end]);

  if (left === null) {
    return <span>{label}</span>;
  }

  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  return (
    <span>
      <span className="sr-only">{label}. </span>
      <span aria-hidden="true">
        Held for another{" "}
        <span className="tabular font-semibold">
          {minutes}:{seconds}
        </span>
      </span>
    </span>
  );
}

/**
 * Watches a payment that is waiting for the guest's PIN. It asks the server
 * every few seconds, and moves on by itself when the payment lands or fails.
 */
export function PaymentWatcher({
  statusUrl,
  paidUrl,
  failedUrl,
}: {
  statusUrl: string;
  paidUrl: string;
  failedUrl: string;
}) {
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    let stopped = false;
    const started = Date.now();

    const ask = async () => {
      try {
        const response = await fetch(statusUrl, { cache: "no-store", headers: { Accept: "application/json" } });
        if (response.ok) {
          const answer = (await response.json()) as { status: "pending" | "paid" | "failed" };
          if (stopped) return;
          if (answer.status === "paid") {
            window.location.assign(paidUrl);
            return;
          }
          if (answer.status === "failed") {
            window.location.assign(failedUrl);
            return;
          }
        }
      } catch {
        // A dropped connection is not a failed payment. Keep asking.
      }
      if (!stopped) {
        setWaited(Math.floor((Date.now() - started) / 1000));
        timer = window.setTimeout(ask, 2500);
      }
    };

    let timer = window.setTimeout(ask, 2500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [statusUrl, paidUrl, failedUrl]);

  return (
    <p className="mt-4 text-sm text-ink-faint" aria-live="polite">
      {waited < 45
        ? "This page moves on by itself when the payment arrives."
        : waited < 120
          ? "Still waiting. If the prompt has gone from your phone, it may have timed out. This page will say so shortly."
          : "This is taking longer than usual. We are asking M-Pesa what happened."}
    </p>
  );
}
