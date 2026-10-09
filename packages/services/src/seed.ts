import { contracts, eq, getDb, milestones } from "@proofbill/db";
import { audit } from "./audit";
import { confirmContract, createDraftFromText, extractedToConfirmed } from "./contracts";
import { addEvidence, mapPendingEvidence, reviewEvidence } from "./evidence";
import { addTimeEntry, clientDecision, submitMilestone } from "./milestones";
import { SAMPLE_SOW } from "./sample-sow";
import type { ExtractedTerms } from "@proofbill/core";

export { SAMPLE_SOW };

/**
 * Judge mode: a ready-to-demo Larkspur workspace.
 *  M1 accepted by the client with confirmed PR evidence → ready to invoice
 *  M2 in progress, one PR awaiting the freelancer's confirmation of the AI mapping + a design link
 *  M3 planned (depends on M2) · M4 change requests with logged hours
 */
export async function seedDemoWorkspace(userId: string, opts: { reset?: boolean; repo?: string; clientEmail?: string } = {}): Promise<string> {
  const db = getDb();
  if (opts.reset) await db.delete(contracts).where(eq(contracts.userId, userId));
  const repo = opts.repo ?? process.env.DEMO_REPO ?? "DemonDestroyerAbhi/larkspur-invoice-export";
  const sow = SAMPLE_SOW.replace("[your-github]/larkspur-invoice-export", repo).replace("[Your Name]", process.env.FREELANCER_NAME ?? "Demo Freelancer");

  const draft = await createDraftFromText(userId, { name: "larkspur-sow.md", text: sow });
  const terms = extractedToConfirmed(draft.extracted as ExtractedTerms);
  // Invoices go to the sandbox PERSONAL account so the demo can pay them.
  if (opts.clientEmail ?? process.env.PAYER_EMAIL) terms.clientEmail = (opts.clientEmail ?? process.env.PAYER_EMAIL)!;
  const { issues } = await confirmContract(userId, draft.id, terms);
  if (issues.some((i) => i.level === "error")) throw new Error(`Seed terms invalid: ${JSON.stringify(issues)}`);

  const ms = await db.select().from(milestones).where(eq(milestones.contractId, draft.id));
  const m = (n: number) => ms.find((x) => x.number === n)!;
  const t0 = Date.now() - 6 * 86_400_000;
  const pr = (n: number, title: string, files: string[], body: string, daysAgo: number) => ({
    type: "github_pr" as const,
    ref: `${repo}#${n}`,
    url: `https://github.com/${repo}/pull/${n}`,
    title: `PR #${n}: ${title}`,
    capturedAt: new Date(t0 + (6 - daysAgo) * 86_400_000),
    meta: { repo, number: n, body, files, labels: [], seeded: true },
  });

  await addEvidence(draft.id, pr(12, "Email/password signup and login", ["src/auth/signup.ts", "src/auth/login.ts", "test/auth.test.ts"], "Adds signup + login with bcrypt hashing. Tests passing.", 5));
  await addEvidence(draft.id, pr(15, "Password reset flow with tests", ["src/auth/reset.ts", "src/mail/templates/reset.html", "test/reset.test.ts"], "Token-based password reset; all auth tests green in CI.", 4));
  await addEvidence(draft.id, pr(18, "CSV export endpoint for invoices", ["src/api/export/csv.ts", "test/export.csv.test.ts"], "GET /api/invoices/export.csv streams invoices as CSV.", 1));
  await addEvidence(
    draft.id,
    { type: "link", ref: "figma:export-dialog", url: "https://www.figma.com/", title: "Figma: PDF export layout (approved by Larkspur design)", meta: { note: "Layout for the PDF invoice export" } },
    "user",
  );
  await mapPendingEvidence(draft.id);

  const ev = await db.query.evidence.findMany({ where: (e, { eq }) => eq(e.contractId, draft.id) });
  for (const e of ev) {
    if (e.ref.endsWith("#12") || e.ref.endsWith("#15")) await reviewEvidence(userId, e.id, { action: "confirm", milestoneId: m(1).id });
    if (e.ref === "figma:export-dialog") await reviewEvidence(userId, e.id, { action: "confirm", milestoneId: m(2).id });
  }

  await submitMilestone(userId, m(1).id, "Auth module complete: signup, login and password reset, with tests passing in CI.");
  await clientDecision(draft.portalToken, m(1).id, { action: "accept", name: "Priya (Larkspur finance)" });

  if (ms.length >= 4) {
    const d = (k: number) => new Date(Date.now() - k * 86_400_000).toISOString().slice(0, 10);
    await addTimeEntry(userId, m(4).id, { date: d(3), hours: 2, note: "Added Xero-compatible CSV column mapping (approved by email)" });
    await addTimeEntry(userId, m(4).id, { date: d(2), hours: 1.5, note: "Extra currency formatting options requested by finance" });
  }

  await audit(db, { contractId: draft.id, entity: "contract", entityId: draft.id, action: "demo_seeded", actor: "system", summary: "Demo workspace seeded (judge mode)" });
  return draft.id;
}
