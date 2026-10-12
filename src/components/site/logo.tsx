/** The mark: the twin peaks of Mount Kenya above a level line, the edge. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path
        d="M3 21.5 10.5 12l3.2 3.9L19 7l10 14.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 26h26" stroke="var(--color-ember-500)" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark className="size-8 shrink-0" />
      <span className="font-display text-[1.75rem] leading-none tracking-[-0.01em]">Ukingo</span>
    </span>
  );
}
