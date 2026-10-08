import { ExtractedTerms } from "@proofbill/core";
import { aiEnabled, structured } from "./llm";
import { heuristicExtract } from "./heuristics";

export interface ExtractionResult {
  terms: ExtractedTerms;
  by: string; // model id or "heuristic"
}

const SYSTEM = `You extract billing terms from freelance contracts (SOWs, agreements, email threads) for ProofBill, an invoicing tool.

Rules:
- Extract only what the document states. If a term is absent, use null for its value and null for its source. Never invent amounts, dates or rates.
- Every non-null value MUST carry a source: the section/heading label and a short verbatim quote from the document that supports it.
- Amounts are plain numbers in the contract currency (600 for "$600"). Percentages are plain numbers (1.5 for "1.5%").
- Dates are YYYY-MM-DD. Resolve partial dates using the document's effective date/year when unambiguous; otherwise null.
- rateType is "fixed" if milestones have fixed fees, "hourly" if the whole engagement is billed by time. Hourly change-request clauses on a fixed contract go in hourlyRate / hourlyCapHours, not rateType.
- netDays: "Net 15" → 15; "due on receipt" → 0.
- acceptanceWindowBizDays: number of business days the client has to accept/reject delivered work.
- partialMinPct: minimum partial payment as a percent of the invoice; null if partial payments are not allowed or not mentioned.
- milestones: in document order. acceptanceCriteria is a list of concrete, checkable criteria (split compound criteria). dependsOn uses 1-based milestone numbers ("depends on Milestone 1" → [1]); dependency phrases are not criteria.
- title: a short name for the engagement.`;

export async function extractTerms(text: string, filename?: string): Promise<ExtractionResult> {
  if (!aiEnabled()) return { terms: heuristicExtract(text), by: "heuristic" };
  const { data, model } = await structured({
    schema: ExtractedTerms,
    system: SYSTEM,
    user: `<document name="${(filename ?? "contract").replace(/"/g, "")}">\n${text}\n</document>\n\nExtract the billing terms.`,
  });
  return { terms: data, by: model };
}
