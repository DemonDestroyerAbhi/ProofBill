import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heuristicExtract, heuristicMap, mentionsMoney, templateReminder } from "../src";

const sow = readFileSync(new URL("../../../sample-sow.md", import.meta.url), "utf8");

describe("heuristic extraction of sample-sow.md", () => {
  const t = heuristicExtract(sow);
  it("gets every scalar term with a source clause", () => {
    expect(t.clientName.value).toBe("Larkspur Labs Ltd.");
    expect(t.clientEmail.value).toBe("billing@larkspur.example");
    expect(t.currency.value).toBe("USD");
    expect(t.effectiveDate.value).toBe("2026-10-12");
    expect(t.rateType.value).toBe("fixed");
    expect(t.hourlyRate.value).toBe(40);
    expect(t.hourlyCapHours.value).toBe(20);
    expect(t.totalCap.value).toBe(3000);
    expect(t.netDays.value).toBe(15);
    expect(t.partialMinPct.value).toBe(25);
    expect(t.lateFeePctMonthly.value).toBe(1.5);
    expect(t.acceptanceWindowBizDays.value).toBe(5);
    for (const k of ["hourlyRate", "totalCap", "netDays", "partialMinPct", "lateFeePctMonthly", "acceptanceWindowBizDays"] as const) {
      expect(t[k].source?.quote.length).toBeGreaterThan(5);
    }
    expect(t.totalCap.source?.section).toMatch(/Change requests/);
  });
  it("gets milestones, criteria, dependencies and dates", () => {
    expect(t.milestones.map((m) => [m.title, m.amount, m.dueDate, m.dependsOn])).toEqual([
      ["Authentication module", 600, "2026-10-24", []],
      ["Invoice export API", 900, "2026-11-07", [1]],
      ["Admin dashboard", 700, "2026-11-21", [2]],
    ]);
    expect(t.milestones[0]!.acceptanceCriteria).toEqual(["Email/password signup", "login", "password reset", "tests passing"]);
    expect(t.milestones[1]!.acceptanceCriteria.join(" ")).not.toMatch(/depends/i);
  });
});

describe("heuristic mapping", () => {
  const ms = heuristicExtract(sow).milestones.map((m, i) => ({ number: i + 1, title: m.title, acceptanceCriteria: m.acceptanceCriteria, status: "in_progress" }));
  it("maps a PR by keywords", () => {
    const r = heuristicMap({ type: "github_pr", title: "Add password reset flow", files: ["src/auth/reset.ts"] }, ms);
    expect(r.milestoneNumber).toBe(1);
  });
  it("honours explicit milestone references", () => {
    expect(heuristicMap({ type: "github_pr", title: "M2: CSV export endpoint" }, ms)).toMatchObject({ milestoneNumber: 2, confidence: 0.9 });
  });
  it("leaves unrelated evidence unmapped", () => {
    expect(heuristicMap({ type: "github_pr", title: "Bump eslint" }, ms).milestoneNumber).toBeNull();
  });
});

describe("guardrails", () => {
  it("detects money in AI text", () => {
    expect(mentionsMoney("Total due $600")).toBe(true);
    expect(mentionsMoney("Paid 150.00 USD")).toBe(true);
    expect(mentionsMoney("Implemented login (PR #12) and 3 tests")).toBe(false);
  });
  it("escalates reminder tone", () => {
    const base = { clientName: "Larkspur", freelancerName: "A", invoiceNumber: "PB-1", milestoneTitle: "Auth", partiallyPaid: false, acceptedBy: "client", lateFeePctMonthly: 1.5 };
    expect(templateReminder({ ...base, daysOverdue: 2, reminderCount: 0 }).tone).toBe("friendly");
    expect(templateReminder({ ...base, daysOverdue: 20, reminderCount: 1 }).tone).toBe("firm");
    expect(templateReminder({ ...base, daysOverdue: 60, reminderCount: 3 }).tone).toBe("final");
  });
});
