import type { Cents } from "./money";
import { daysBetween } from "./dates";

/**
 * Late fee policy (documented in README):
 * - Simple interest, non-compounding, on the balance outstanding at assessment time.
 * - Assessed once per full 30-day period overdue (month 1 at due+30d, month 2 at due+60d, …).
 * - Issued as a separate late-fee invoice; excluded from the contract value cap (it's a penalty, not work).
 */
export function lateFeeMonthsElapsed(dueDate: Date, now: Date): number {
  const days = daysBetween(dueDate, now);
  return days < 30 ? 0 : Math.floor(days / 30);
}

export function lateFeeCents(outstandingCents: Cents, pctMonthly: number): Cents {
  if (outstandingCents <= 0 || pctMonthly <= 0) return 0;
  return Math.round((outstandingCents * pctMonthly) / 100);
}

export interface LateFeeDecision {
  period: number;
  amountCents: Cents;
}

/** Which late-fee periods are due but not yet assessed. Idempotent by period number. */
export function dueLateFees(args: {
  dueDate: Date;
  now: Date;
  outstandingCents: Cents;
  pctMonthly: number | null;
  assessedPeriods: number[];
}): LateFeeDecision[] {
  if (!args.pctMonthly) return [];
  const months = lateFeeMonthsElapsed(args.dueDate, args.now);
  const out: LateFeeDecision[] = [];
  for (let p = 1; p <= months; p++) {
    if (args.assessedPeriods.includes(p)) continue;
    const amountCents = lateFeeCents(args.outstandingCents, args.pctMonthly);
    if (amountCents > 0) out.push({ period: p, amountCents });
  }
  return out;
}

/** Reminder cadence: first reminder 1 day overdue, then every 7 days. */
export function isReminderDue(args: { dueDate: Date; now: Date; lastReminderAt: Date | null }): boolean {
  if (daysBetween(args.dueDate, args.now) < 1) return false;
  if (!args.lastReminderAt) return true;
  return daysBetween(args.lastReminderAt, args.now) >= 7;
}
