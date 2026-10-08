/** Mappings below this confidence stay `proposed` and need a human to map them. */
export const AUTO_PROPOSE_THRESHOLD = 0.6;

export type EvidenceType = "github_pr" | "url_check" | "file" | "link";
export type EvidenceStatus = "proposed" | "confirmed" | "rejected";

export interface MappingDecision {
  milestoneNumber: number | null;
  confidence: number;
  rationale: string;
}

/**
 * Confidence gate. Even high-confidence mappings are only `proposed` — a human confirms every one.
 * Low confidence → unmapped, so it shows up in the "needs manual mapping" queue.
 */
export function gateMapping(d: MappingDecision): { milestoneNumber: number | null; needsManual: boolean } {
  if (d.milestoneNumber == null || d.confidence < AUTO_PROPOSE_THRESHOLD)
    return { milestoneNumber: null, needsManual: true };
  return { milestoneNumber: d.milestoneNumber, needsManual: false };
}

/** Progress for the timeline: share of acceptance criteria with confirmed evidence. */
export function milestoneProgress(status: string, criteriaCount: number, coveredCriteria: number): number {
  if (["accepted", "invoiced", "paid"].includes(status)) return 100;
  if (status === "submitted") return 90;
  if (criteriaCount === 0) return 0;
  return Math.min(85, Math.round((coveredCriteria / criteriaCount) * 85));
}
