// Arithmetic on money, which is always whole cents.

/** A share of an amount, rounded up to the next whole shilling and never more than the amount. */
export function percentOf(cents: number, percent: number): number {
  return Math.min(cents, Math.ceil((cents * percent) / 100 / 100) * 100);
}
