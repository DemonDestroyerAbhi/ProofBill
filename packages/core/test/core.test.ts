import { describe, expect, it } from "vitest";
import {
  acceptanceDeadline,
  addBusinessDays,
  blockingDependencies,
  centsToString,
  dueLateFees,
  invoiceNumber,
  isAutoAcceptDue,
  isReminderDue,
  minimumPaymentCents,
  priceMilestone,
  transition,
  TransitionError,
  validateTerms,
  gateMapping,
  assertWithinCap,
  CapExceededError,
  netTermType,
  type ConfirmedTerms,
  type PricingContract,
} from "../src";

// Larkspur SOW: $600/$900/$700 fixed, $40/h change requests capped 20h, total cap $3,000,
// Net-15, partial min 25%, late fee 1.5%/mo, 5-business-day acceptance.
const larkspur: PricingContract = {
  rateType: "fixed",
  hourlyRateCents: 4000,
  hourlyCapHours: 20,
  totalCapCents: 300000,
  partialMinPct: 25,
};
const none = { invoicedCents: 0, invoicedHoursX100: 0 };

describe("money", () => {
  it("formats cents", () => {
    expect(centsToString(60000)).toBe("600.00");
    expect(centsToString(5)).toBe("0.05");
    expect(centsToString(-1250)).toBe("-12.50");
  });
});

describe("pricing", () => {
  it("prices a fixed milestone from contract terms", () => {
    const r = priceMilestone(larkspur, { number: 1, title: "Authentication module", billing: "fixed", amountCents: 60000 }, [], none);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalCents).toBe(60000);
    expect(r.lines[0]).toMatchObject({ unitOfMeasure: "AMOUNT", quantity: "1", unitAmountCents: 60000 });
    expect(r.minimumPaymentCents).toBe(15000);
    expect(r.remainingCapCents).toBe(240000);
  });

  it("prices hourly work from time entries", () => {
    const r = priceMilestone(
      larkspur,
      { number: 4, title: "Change requests", billing: "hourly", amountCents: null },
      [
        { id: "a", date: "2026-10-20", hoursX100: 250, note: "" },
        { id: "b", date: "2026-10-21", hoursX100: 125, note: "" },
      ],
      none,
    );
    expect(r.ok && r.totalCents).toBe(15000); // 3.75h × $40
    expect(r.ok && r.lines[0]?.quantity).toBe("3.75");
    expect(r.ok && r.lines[0]?.timeEntryIds).toEqual(["a", "b"]);
  });

  it("blocks invoices over the contract cap", () => {
    const r = priceMilestone(
      larkspur,
      { number: 3, title: "Admin dashboard", billing: "fixed", amountCents: 70000 },
      [],
      { invoicedCents: 250000, invoicedHoursX100: 0 },
    );
    expect(r).toMatchObject({ ok: false, code: "OVER_CAP" });
  });

  it("allows an invoice that lands exactly on the cap", () => {
    const r = priceMilestone(
      larkspur,
      { number: 3, title: "Admin dashboard", billing: "fixed", amountCents: 70000 },
      [],
      { invoicedCents: 230000, invoicedHoursX100: 0 },
    );
    expect(r.ok && r.remainingCapCents).toBe(0);
  });

  it("blocks hours beyond the hourly cap", () => {
    const r = priceMilestone(
      larkspur,
      { number: 4, title: "Change requests", billing: "hourly", amountCents: null },
      [{ id: "a", date: "2026-10-20", hoursX100: 600, note: "" }],
      { invoicedCents: 0, invoicedHoursX100: 1500 },
    );
    expect(r).toMatchObject({ ok: false, code: "OVER_HOURS_CAP" });
  });

  it("refuses to bill nothing", () => {
    expect(priceMilestone(larkspur, { number: 4, title: "CR", billing: "hourly", amountCents: null }, [], none)).toMatchObject({
      ok: false,
      code: "NOTHING_TO_BILL",
    });
  });

  it("final cap gate throws", () => {
    expect(() => assertWithinCap(larkspur, 250000, 70000)).toThrow(CapExceededError);
    expect(() => assertWithinCap({ totalCapCents: null }, 9e9, 1)).not.toThrow();
  });

  it("minimum payment rounds up", () => {
    expect(minimumPaymentCents(10001, 25)).toBe(2501);
    expect(minimumPaymentCents(10000, null)).toBeNull();
  });
});

describe("acceptance", () => {
  it("adds business days skipping weekends", () => {
    // Fri 2026-10-23 15:00Z + 5 business days → Fri 2026-10-30 15:00Z
    expect(addBusinessDays(new Date("2026-10-23T15:00:00Z"), 5).toISOString()).toBe("2026-10-30T15:00:00.000Z");
    // Sat → following Fri
    expect(addBusinessDays(new Date("2026-10-24T10:00:00Z"), 5).toISOString()).toBe("2026-10-30T10:00:00.000Z");
    // Mon → Mon
    expect(addBusinessDays(new Date("2026-10-19T09:00:00Z"), 5).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("auto-accepts after silence past the window", () => {
    const deadline = acceptanceDeadline(new Date("2026-10-19T09:00:00Z"), 5);
    expect(isAutoAcceptDue({ status: "submitted", acceptanceDeadline: deadline }, new Date("2026-10-26T08:59:59Z"))).toBe(false);
    expect(isAutoAcceptDue({ status: "submitted", acceptanceDeadline: deadline }, new Date("2026-10-26T09:00:00Z"))).toBe(true);
    expect(isAutoAcceptDue({ status: "rejected", acceptanceDeadline: deadline }, new Date("2027-01-01"))).toBe(false);
  });

  it("enforces the milestone state machine", () => {
    expect(transition("in_progress", "submit")).toBe("submitted");
    expect(transition("rejected", "submit")).toBe("submitted");
    expect(transition("submitted", "accept")).toBe("accepted");
    expect(() => transition("planned", "accept")).toThrow(TransitionError);
    expect(() => transition("accepted", "invoice")).not.toThrow();
    expect(() => transition("submitted", "invoice")).toThrow(TransitionError);
  });

  it("blocks submit until dependencies are accepted", () => {
    const all = [
      { id: "1", number: 1, status: "submitted" as const, dependsOn: [] },
      { id: "2", number: 2, status: "in_progress" as const, dependsOn: [1] },
    ];
    expect(blockingDependencies(all[1]!, all).map((m) => m.number)).toEqual([1]);
    all[0]!.status = "accepted" as never;
    expect(blockingDependencies(all[1]!, all)).toEqual([]);
  });
});

describe("late fees and reminders", () => {
  const due = new Date("2026-11-08T00:00:00Z");
  it("assesses 1.5%/month per full 30 days, once per period", () => {
    expect(dueLateFees({ dueDate: due, now: new Date("2026-12-07T00:00:00Z"), outstandingCents: 60000, pctMonthly: 1.5, assessedPeriods: [] })).toEqual([]);
    expect(dueLateFees({ dueDate: due, now: new Date("2026-12-08T00:00:00Z"), outstandingCents: 60000, pctMonthly: 1.5, assessedPeriods: [] })).toEqual([
      { period: 1, amountCents: 900 },
    ]);
    expect(dueLateFees({ dueDate: due, now: new Date("2027-01-08T00:00:00Z"), outstandingCents: 45000, pctMonthly: 1.5, assessedPeriods: [1] })).toEqual([
      { period: 2, amountCents: 675 },
    ]);
    expect(dueLateFees({ dueDate: due, now: new Date("2027-01-08T00:00:00Z"), outstandingCents: 0, pctMonthly: 1.5, assessedPeriods: [] })).toEqual([]);
    expect(dueLateFees({ dueDate: due, now: new Date("2027-01-08T00:00:00Z"), outstandingCents: 100, pctMonthly: null, assessedPeriods: [] })).toEqual([]);
  });

  it("reminds 1 day overdue then weekly", () => {
    expect(isReminderDue({ dueDate: due, now: new Date("2026-11-08T12:00:00Z"), lastReminderAt: null })).toBe(false);
    expect(isReminderDue({ dueDate: due, now: new Date("2026-11-09T00:00:00Z"), lastReminderAt: null })).toBe(true);
    expect(isReminderDue({ dueDate: due, now: new Date("2026-11-12T00:00:00Z"), lastReminderAt: new Date("2026-11-09T00:00:00Z") })).toBe(false);
    expect(isReminderDue({ dueDate: due, now: new Date("2026-11-16T00:00:00Z"), lastReminderAt: new Date("2026-11-09T00:00:00Z") })).toBe(true);
  });
});

describe("guardrails", () => {
  it("invoice numbers are deterministic", () => {
    expect(invoiceNumber("LARK7", 1)).toBe("PB-LARK7-M1");
    expect(invoiceNumber("LARK7", 4, 2)).toBe("PB-LARK7-M4-2");
  });

  it("maps net days to PayPal term types", () => {
    expect(netTermType(15)).toBe("NET_15");
    expect(netTermType(0)).toBe("DUE_ON_RECEIPT");
  });

  it("low-confidence evidence needs manual mapping", () => {
    expect(gateMapping({ milestoneNumber: 1, confidence: 0.9, rationale: "" })).toEqual({ milestoneNumber: 1, needsManual: false });
    expect(gateMapping({ milestoneNumber: 1, confidence: 0.3, rationale: "" })).toEqual({ milestoneNumber: null, needsManual: true });
  });

  it("validates confirmed terms", () => {
    const t: ConfirmedTerms = {
      title: "x",
      clientName: "Larkspur",
      clientEmail: "billing@larkspur.example",
      currency: "USD",
      rateType: "fixed",
      hourlyRateCents: 4000,
      hourlyCapHours: 20,
      totalCapCents: 100000,
      netDays: 15,
      partialMinPct: 25,
      lateFeePctMonthly: 1.5,
      acceptanceWindowBizDays: 5,
      milestones: [
        { title: "A", acceptanceCriteria: [], amountCents: 60000, dueDate: null, dependsOn: [], billing: "fixed" },
        { title: "B", acceptanceCriteria: [], amountCents: 90000, dueDate: null, dependsOn: [1], billing: "fixed" },
      ],
    };
    expect(validateTerms(t).filter((i) => i.level === "error").map((i) => i.field)).toEqual(["totalCap"]);
    t.totalCapCents = 300000;
    expect(validateTerms(t)).toEqual([]);
  });
});
