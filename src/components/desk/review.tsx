import { isSetupAction, setupAction, type SetupActionName, type Waiting } from "@/server/desk/setup";
import { unseal } from "@/server/flash";
import type { Staff } from "@/server/staff/permissions";

/** The change waiting to be confirmed on this screen, if the address carries one this person made. */
export function waitingChange(
  review: string | string[] | undefined,
  staff: Staff,
): (Waiting & { sealed: string }) | null {
  if (typeof review !== "string") return null;
  const waiting = unseal<Waiting>(review);
  if (!waiting || waiting.by !== staff.id || !isSetupAction(waiting.action)) return null;
  return { ...waiting, sealed: review };
}

/** What a waiting change proposes, when it is one of the kinds this form makes. */
export function proposed<P>(waiting: Waiting | null, ...actions: SetupActionName[]): P | null {
  return waiting && actions.includes(waiting.action) ? (waiting.proposal as P) : null;
}

/**
 * A change to prices or rules, said back before it is saved: each thing that
 * would differ, what it will and will not touch, and the two ways out.
 */
export async function ReviewPanel({
  waiting,
  back,
}: {
  waiting: (Waiting & { sealed: string }) | null;
  /** The screen's own address, without the change. */
  back: string;
}) {
  if (!waiting) return null;
  const action = setupAction(waiting.action);
  const lines = action.lines ? await action.lines(waiting.proposal) : [];
  if (lines.length === 0) return null;

  return (
    <section
      aria-labelledby="review-heading"
      className="mb-5 rounded-xl border border-ember-600/40 bg-ember-100 p-4 sm:p-5"
    >
      <h2 id="review-heading" className="display text-2xl text-night-950">
        Check this before it is saved
      </h2>
      <ul className="mt-3 space-y-1.5 text-night-950">
        {lines.map((line) => (
          <li key={line} className="flex gap-2.5">
            <span aria-hidden="true" className="mt-[0.7em] h-px w-3 shrink-0 bg-ember-800" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {action.review ? <p className="mt-3 text-sm text-ember-800">{action.review.affects}</p> : null}
      <form action="/desk/setup/act" method="post" className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="confirm" value={waiting.sealed} />
        <input type="hidden" name="back" value={back} />
        <button type="submit" className="button button-night min-h-10 px-5 py-2 text-sm">
          Save {lines.length === 1 ? "this change" : `these ${lines.length} changes`}
        </button>
        <a href={back} className="button button-line min-h-10 border-night-900/30 px-4 py-2 text-sm">
          Leave it as it was
        </a>
      </form>
    </section>
  );
}
