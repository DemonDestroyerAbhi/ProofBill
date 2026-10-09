import { type Cents, type HoursX100, hourlyAmount, hoursToString } from "./money";

/**
 * Invoice amounts are computed HERE, from confirmed contract terms. The LLM never sets a price:
 * AI only writes the human-readable description of each line.
 */

export interface PricingContract {
  rateType: "fixed" | "hourly";
  hourlyRateCents: Cents | null;
  hourlyCapHours: number | null; // whole hours, e.g. 20
  totalCapCents: Cents | null;
  partialMinPct: number | null;
}

export interface PricingMilestone {
  number: number;
  title: string;
  billing: "fixed" | "hourly";
  amountCents: Cents | null;
}

export interface PricingTimeEntry {
  id: string;
  date: string;
  hoursX100: HoursX100;
  note: string;
}

export interface BillingHistory {
  /** Sum of all non-cancelled, non-late-fee invoices on this contract. */
  invoicedCents: Cents;
  /** Hours already invoiced on hourly lines across this contract. */
  invoicedHoursX100: HoursX100;
}

export interface ComputedLine {
  key: string;
  name: string;
  unitOfMeasure: "AMOUNT" | "HOURS";
  quantity: string;
  unitAmountCents: Cents;
  totalCents: Cents;
  timeEntryIds: string[];
}

export type PricingResult =
  | {
      ok: true;
      lines: ComputedLine[];
      totalCents: Cents;
      minimumPaymentCents: Cents | null;
      remainingCapCents: Cents | null;
    }
  | { ok: false; code: "OVER_CAP" | "OVER_HOURS_CAP" | "NOTHING_TO_BILL" | "MISSING_RATE"; message: string };

export function minimumPaymentCents(totalCents: Cents, partialMinPct: number | null): Cents | null {
  if (partialMinPct == null) return null;
  return Math.ceil((totalCents * partialMinPct) / 100);
}

export function priceMilestone(
  contract: PricingContract,
  milestone: PricingMilestone,
  timeEntries: PricingTimeEntry[],
  history: BillingHistory,
): PricingResult {
  const lines: ComputedLine[] = [];

  if (milestone.billing === "fixed") {
    if (milestone.amountCents == null || milestone.amountCents <= 0)
      return { ok: false, code: "NOTHING_TO_BILL", message: `Milestone ${milestone.number} has no fee` };
    lines.push({
      key: `m${milestone.number}`,
      name: `Milestone ${milestone.number}: ${milestone.title}`,
      unitOfMeasure: "AMOUNT",
      quantity: "1",
      unitAmountCents: milestone.amountCents,
      totalCents: milestone.amountCents,
      timeEntryIds: [],
    });
  } else {
    if (!contract.hourlyRateCents)
      return { ok: false, code: "MISSING_RATE", message: "Contract has no hourly rate" };
    const hours = timeEntries.reduce((s, e) => s + e.hoursX100, 0);
    if (hours <= 0) return { ok: false, code: "NOTHING_TO_BILL", message: "No unbilled time entries" };
    if (contract.hourlyCapHours != null) {
      const capX100 = contract.hourlyCapHours * 100;
      if (history.invoicedHoursX100 + hours > capX100) {
        return {
          ok: false,
          code: "OVER_HOURS_CAP",
          message: `Hourly cap is ${contract.hourlyCapHours}h; ${hoursToString(history.invoicedHoursX100)}h already invoiced, this would add ${hoursToString(hours)}h`,
        };
      }
    }
    lines.push({
      key: `m${milestone.number}-hours`,
      name: `Milestone ${milestone.number}: ${milestone.title}`,
      unitOfMeasure: "HOURS",
      quantity: hoursToString(hours),
      unitAmountCents: contract.hourlyRateCents,
      totalCents: hourlyAmount(contract.hourlyRateCents, hours),
      timeEntryIds: timeEntries.map((e) => e.id),
    });
  }

  const totalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  let remainingCapCents: Cents | null = null;
  if (contract.totalCapCents != null) {
    remainingCapCents = contract.totalCapCents - history.invoicedCents;
    if (totalCents > remainingCapCents) {
      return {
        ok: false,
        code: "OVER_CAP",
        message: `Contract cap exceeded: invoice ${(totalCents / 100).toFixed(2)} > remaining ${(remainingCapCents / 100).toFixed(2)}`,
      };
    }
    remainingCapCents -= totalCents;
  }

  return {
    ok: true,
    lines,
    totalCents,
    minimumPaymentCents: minimumPaymentCents(totalCents, contract.partialMinPct),
    remainingCapCents,
  };
}

/** Final gate right before sending: recompute and compare to what's stored. Defends against edits/races. */
export function assertWithinCap(
  contract: Pick<PricingContract, "totalCapCents">,
  otherInvoicedCents: Cents,
  thisInvoiceCents: Cents,
): void {
  if (contract.totalCapCents != null && otherInvoicedCents + thisInvoiceCents > contract.totalCapCents) {
    throw new CapExceededError(contract.totalCapCents, otherInvoicedCents, thisInvoiceCents);
  }
}

export class CapExceededError extends Error {
  code = "OVER_CAP" as const;
  constructor(public capCents: Cents, public otherCents: Cents, public thisCents: Cents) {
    super(
      `Over-cap invoice blocked: ${(otherCents / 100).toFixed(2)} already invoiced + ${(thisCents / 100).toFixed(2)} > cap ${(capCents / 100).toFixed(2)}`,
    );
  }
}
