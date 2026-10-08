import { z } from "zod";
import { aiEnabled, structured } from "./llm";

export interface LineContext {
  key: string;
  name: string;
  unitOfMeasure: "AMOUNT" | "HOURS";
  quantity: string;
}

export interface LineEvidence {
  id: string;
  title: string;
  url: string | null;
  summary: string | null;
}

export const LinesOutput = z.object({
  lines: z.array(
    z.object({
      key: z.string(),
      description: z.string().describe("1–3 sentences: what was delivered, referencing evidence by short name (e.g. 'PR #12'). No prices."),
      evidenceIds: z.array(z.string()).describe("IDs of evidence items cited in the description"),
    }),
  ),
  note: z.string().describe("Short, friendly invoice note to the client (2–4 sentences). No prices or totals."),
});
export type LinesOutput = z.infer<typeof LinesOutput>;

const SYSTEM = `You write client-readable invoice line descriptions for a freelancer's PayPal invoice.

- Describe what was delivered for each line, grounded ONLY in the provided acceptance criteria and evidence. Cite evidence by short name (e.g. "PR #12").
- NEVER mention prices, totals, rates, hours or any money amounts — amounts are computed separately by the billing engine and you must not restate or change them.
- Plain, professional, specific. No marketing language.
- The note thanks the client and says acceptance/evidence details are in the ProofBill evidence portal.`;

const MONEY_RE = /(?:[$€£₹]\s?\d)|(?:\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|INR|dollars?)\b)/i;

/** Guardrail: AI text that mentions money is discarded in favour of the template. */
export function mentionsMoney(s: string): boolean {
  return MONEY_RE.test(s);
}

export async function writeInvoiceLines(args: {
  clientName: string;
  milestone: { number: number; title: string; acceptanceCriteria: string[]; acceptedBy: string | null };
  lines: LineContext[];
  evidence: LineEvidence[];
  timeNotes?: string[];
}): Promise<LinesOutput & { by: string; rejected?: string }> {
  const fallback = templateLines(args);
  if (!aiEnabled()) return { ...fallback, by: "template" };
  const { data, model } = await structured({
    schema: LinesOutput,
    system: SYSTEM,
    maxTokens: 4000,
    user: JSON.stringify(
      {
        client: args.clientName,
        milestone: args.milestone,
        lines: args.lines.map((l) => ({ key: l.key, name: l.name, unit: l.unitOfMeasure })),
        evidence: args.evidence,
        timeEntryNotes: args.timeNotes ?? [],
      },
      null,
      2,
    ),
  });
  const known = new Set(args.evidence.map((e) => e.id));
  const bad = [data.note, ...data.lines.map((l) => l.description)].find(mentionsMoney);
  if (bad) return { ...fallback, by: "template", rejected: `AI text mentioned an amount and was discarded: "${bad.slice(0, 120)}"` };
  return {
    note: data.note,
    lines: args.lines.map((l) => {
      const out = data.lines.find((x) => x.key === l.key);
      const fb = fallback.lines.find((x) => x.key === l.key)!;
      return out
        ? { key: l.key, description: out.description, evidenceIds: out.evidenceIds.filter((id) => known.has(id)) }
        : fb;
    }),
    by: model,
  };
}

export function templateLines(args: {
  milestone: { number: number; title: string; acceptanceCriteria: string[]; acceptedBy: string | null };
  lines: LineContext[];
  evidence: LineEvidence[];
}): LinesOutput {
  const ev = args.evidence.slice(0, 6).map((e) => e.title).join("; ");
  const crit = args.milestone.acceptanceCriteria.join("; ");
  return {
    note: `Thank you! This invoice covers Milestone ${args.milestone.number} (${args.milestone.title}), ${
      args.milestone.acceptedBy === "auto" ? "accepted after the contractual review window" : "accepted in the ProofBill evidence portal"
    }. Evidence for each acceptance criterion is linked in the portal.`,
    lines: args.lines.map((l) => ({
      key: l.key,
      description: [crit && `Delivered: ${crit}.`, ev && `Evidence: ${ev}.`].filter(Boolean).join(" ").slice(0, 1000),
      evidenceIds: args.evidence.map((e) => e.id),
    })),
  };
}
