/** Date helpers. Contract dates are calendar dates (YYYY-MM-DD) interpreted in UTC. */

const DAY_MS = 86_400_000;

export function parseDate(d: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Invalid date: ${d}`);
  return new Date(`${d}T00:00:00.000Z`);
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Adds N business days (Mon–Fri) to a timestamp, keeping time of day.
 * Submitted Fri 15:00 + 5 business days → following Fri 15:00.
 * Submitted Sat → counting starts Monday, deadline the following Friday.
 */
export function addBusinessDays(start: Date, n: number): Date {
  let d = new Date(start.getTime());
  let added = 0;
  while (added < n) {
    d = addDays(d, 1);
    if (!isWeekend(d)) added++;
  }
  return d;
}

/** Whole calendar days from a to b (b - a), floor. Negative if b before a. */
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}
