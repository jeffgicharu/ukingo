import type { ReactNode } from "react";

/**
 * Wraps a page that staff may be looking at before its words are published.
 * For a guest it adds nothing. For a preview it puts a bar above the page,
 * and keeps the page's own header below that bar.
 */
export function Previewed({ on, back, children }: { on: boolean; back: string; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <>
      <p className="bg-ember-500 px-4 py-2.5 text-center text-sm font-medium text-night-950">
        This is a preview. Guests do not see these words until they are published.{" "}
        <a href={back} className="underline underline-offset-4">
          Back to the editor
        </a>
      </p>
      <div className="relative flex flex-1 flex-col">{children}</div>
    </>
  );
}
