import { z } from "zod";

/**
 * Where a value came from in the source document. Every AI-extracted field carries one,
 * so the freelancer (and client) can see the clause the number came from.
 */
export const SourceRef = z.object({
  section: z.string().describe("Section/heading/clause label, e.g. '§4 Payment terms'"),
  quote: z.string().describe("Verbatim quote from the document supporting the value"),
});
export type SourceRef = z.infer<typeof SourceRef>;

const field = <T extends z.ZodTypeAny>(v: T) =>
  z.object({ value: v, source: SourceRef.nullable() });

export const ExtractedMilestone = z.object({
  title: z.string(),
  acceptanceCriteria: z.array(z.string()),
  amount: z.number().nullable().describe("Fee in contract currency units (e.g. 600 for $600). null if hourly/unspecified"),
  dueDate: z.string().nullable().describe("YYYY-MM-DD or null"),
  dependsOn: z.array(z.number().int()).describe("1-based numbers of milestones this one depends on"),
  source: SourceRef.nullable(),
});
export type ExtractedMilestone = z.infer<typeof ExtractedMilestone>;

export const ExtractedTerms = z.object({
  title: field(z.string()),
  clientName: field(z.string().nullable()),
  clientEmail: field(z.string().nullable()),
  currency: field(z.string().describe("ISO 4217, e.g. USD")),
  effectiveDate: field(z.string().nullable()),
  rateType: field(z.enum(["fixed", "hourly"])),
  hourlyRate: field(z.number().nullable().describe("Per-hour rate in currency units, for hourly work or change requests")),
  hourlyCapHours: field(z.number().nullable()),
  totalCap: field(z.number().nullable().describe("Maximum total contract value in currency units")),
  netDays: field(z.number().int().nullable()),
  partialMinPct: field(z.number().nullable().describe("Minimum partial payment as percent of invoice, e.g. 25. null if partial payments not allowed")),
  lateFeePctMonthly: field(z.number().nullable()),
  acceptanceWindowBizDays: field(z.number().int().nullable()),
  milestones: z.array(ExtractedMilestone),
});
export type ExtractedTerms = z.infer<typeof ExtractedTerms>;

/** Terms after human review — the only shape the rest of the system trusts. */
export interface ConfirmedTerms {
  title: string;
  clientName: string;
  clientEmail: string;
  currency: string;
  rateType: "fixed" | "hourly";
  hourlyRateCents: number | null;
  hourlyCapHours: number | null;
  totalCapCents: number | null;
  netDays: number;
  partialMinPct: number | null;
  lateFeePctMonthly: number | null;
  acceptanceWindowBizDays: number;
  milestones: {
    title: string;
    acceptanceCriteria: string[];
    amountCents: number | null;
    dueDate: string | null;
    dependsOn: number[];
    billing: "fixed" | "hourly";
  }[];
}

export interface TermsIssue {
  level: "error" | "warning";
  field: string;
  message: string;
}

/** Deterministic sanity checks run on confirm. Errors block, warnings are shown. */
export function validateTerms(t: ConfirmedTerms): TermsIssue[] {
  const issues: TermsIssue[] = [];
  if (!t.clientEmail || !/^[^@\s]+@[^@\s]+$/.test(t.clientEmail))
    issues.push({ level: "error", field: "clientEmail", message: "Client email is required to send invoices" });
  if (t.milestones.length === 0)
    issues.push({ level: "error", field: "milestones", message: "At least one milestone is required" });
  t.milestones.forEach((m, i) => {
    if (m.billing === "fixed" && (m.amountCents == null || m.amountCents <= 0))
      issues.push({ level: "error", field: `milestones.${i}.amount`, message: `Milestone ${i + 1} needs a fee` });
    if (m.billing === "hourly" && !t.hourlyRateCents)
      issues.push({ level: "error", field: "hourlyRate", message: `Milestone ${i + 1} is hourly but no hourly rate is set` });
    for (const d of m.dependsOn) {
      if (d < 1 || d > t.milestones.length || d === i + 1)
        issues.push({ level: "error", field: `milestones.${i}.dependsOn`, message: `Milestone ${i + 1} has invalid dependency ${d}` });
    }
  });
  const fixedTotal = t.milestones.reduce((s, m) => s + (m.billing === "fixed" ? m.amountCents ?? 0 : 0), 0);
  if (t.totalCapCents != null && fixedTotal > t.totalCapCents)
    issues.push({ level: "error", field: "totalCap", message: "Fixed milestone fees exceed the contract cap" });
  if (t.partialMinPct != null && (t.partialMinPct <= 0 || t.partialMinPct >= 100))
    issues.push({ level: "error", field: "partialMinPct", message: "Partial minimum must be between 0 and 100%" });
  if (t.netDays < 0 || t.netDays > 120)
    issues.push({ level: "warning", field: "netDays", message: "Unusual payment term" });
  if (t.lateFeePctMonthly != null && t.lateFeePctMonthly > 5)
    issues.push({ level: "warning", field: "lateFeePctMonthly", message: "Late fee above 5%/month may be unenforceable" });
  return issues;
}
