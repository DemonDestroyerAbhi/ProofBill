import { z } from "zod";
import { aiEnabled, structured } from "./claude";
import { heuristicMap } from "./heuristics";

export interface MappingMilestone {
  number: number;
  title: string;
  acceptanceCriteria: string[];
  status: string;
}

export interface EvidenceInput {
  type: string;
  title: string;
  url?: string | null;
  body?: string | null;
  files?: string[];
  labels?: string[];
}

export const MappingOutput = z.object({
  milestoneNumber: z.number().int().nullable().describe("Best-matching milestone number, or null if none fits"),
  confidence: z.number().describe("0.0–1.0 calibrated confidence that this evidence belongs to that milestone"),
  criteriaMatched: z.array(z.string()).describe("Acceptance criteria (verbatim from the list) this evidence demonstrates"),
  rationale: z.string().describe("One or two sentences citing specific details of the evidence"),
  summary: z.string().describe("Client-readable one-line summary of what this evidence shows"),
});
export type MappingOutput = z.infer<typeof MappingOutput>;

const SYSTEM = `You map a piece of delivery evidence (a merged pull request, a file, a link) to the contract milestone it demonstrates progress on.

- Choose the single best milestone, or null if the evidence does not clearly relate to any.
- Confidence must be calibrated: 0.9+ only when the evidence plainly implements a milestone's criteria; 0.5–0.7 when plausible but indirect; below 0.4 when guessing.
- Only list acceptance criteria the evidence actually demonstrates, copied verbatim.
- The rationale must cite concrete details (PR title, changed files, description) — never generic statements.
- Never infer hours worked or amounts owed from evidence.`;

export async function mapEvidence(ev: EvidenceInput, milestones: MappingMilestone[]): Promise<MappingOutput & { by: string }> {
  if (!aiEnabled()) return { ...heuristicMap(ev, milestones), by: "heuristic" };
  const ms = milestones
    .map((m) => `Milestone ${m.number}: ${m.title} [${m.status}]\n${m.acceptanceCriteria.map((c) => `  - ${c}`).join("\n")}`)
    .join("\n");
  const evText = [
    `Type: ${ev.type}`,
    `Title: ${ev.title}`,
    ev.url ? `URL: ${ev.url}` : null,
    ev.labels?.length ? `Labels: ${ev.labels.join(", ")}` : null,
    ev.files?.length ? `Files changed:\n${ev.files.slice(0, 60).map((f) => `  ${f}`).join("\n")}` : null,
    ev.body ? `Description:\n${ev.body.slice(0, 6000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const { data, model } = await structured({
    schema: MappingOutput,
    system: SYSTEM,
    effort: "low",
    maxTokens: 4000,
    user: `<milestones>\n${ms}\n</milestones>\n\n<evidence>\n${evText}\n</evidence>`,
  });
  const valid = milestones.some((m) => m.number === data.milestoneNumber);
  return {
    ...data,
    milestoneNumber: valid ? data.milestoneNumber : null,
    confidence: Math.max(0, Math.min(1, data.confidence)),
    by: model,
  };
}
