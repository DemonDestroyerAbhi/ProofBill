import { mapEvidence } from "@proofbill/ai";
import { gateMapping, milestoneProgress } from "@proofbill/core";
import { and, asc, contracts, eq, evidence, getDb, isNull, milestones, repos, type Evidence } from "@proofbill/db";
import { audit } from "./audit";
import { GuardrailError, NotFoundError, getContract } from "./contracts";
import { fetchMergedPrs, fetchPrFiles, parseRepo, repoExists, type MergedPr } from "./github";

export interface NewEvidence {
  type: "github_pr" | "url_check" | "file" | "link";
  ref: string;
  url?: string | null;
  title: string;
  meta?: Record<string, unknown>;
  capturedAt?: Date;
  /** Freelancer attached it to a milestone directly (file/link upload) — no AI mapping needed. */
  milestoneId?: string | null;
}

/** Idempotent by (contract, type, ref): webhook + poll can both see the same PR. */
export async function addEvidence(contractId: string, e: NewEvidence, actor: "user" | "system" = "system"): Promise<Evidence | null> {
  const db = getDb();
  const [row] = await db
    .insert(evidence)
    .values({
      contractId,
      type: e.type,
      ref: e.ref,
      url: e.url ?? null,
      title: e.title,
      meta: e.meta ?? {},
      capturedAt: e.capturedAt ?? new Date(),
      milestoneId: e.milestoneId ?? null,
      status: e.milestoneId ? "confirmed" : "proposed",
      mappedAt: e.milestoneId ? new Date() : null,
      aiRationale: e.milestoneId ? "Attached to this milestone by the freelancer" : null,
    })
    .onConflictDoNothing()
    .returning();
  if (row) {
    await audit(db, {
      contractId,
      entity: "evidence",
      entityId: row.id,
      action: "evidence_added",
      actor,
      summary: `Evidence captured: ${e.title}`,
      source: { type: e.type, ref: e.ref, url: e.url },
    });
    if (e.milestoneId) await recomputeProgress(e.milestoneId);
  }
  return row ?? null;
}

export function prToEvidence(fullName: string, pr: MergedPr): NewEvidence {
  return {
    type: "github_pr",
    ref: `${fullName}#${pr.number}`,
    url: pr.url,
    title: `PR #${pr.number}: ${pr.title}`,
    capturedAt: new Date(pr.mergedAt),
    meta: {
      repo: fullName,
      number: pr.number,
      body: pr.body?.slice(0, 8000) ?? null,
      author: pr.author,
      labels: pr.labels,
      files: pr.files ?? [],
      additions: pr.additions,
      deletions: pr.deletions,
      mergedAt: pr.mergedAt,
    },
  };
}

export async function addRepo(userId: string, contractId: string, input: string): Promise<void> {
  await getContract(userId, contractId);
  const fullName = parseRepo(input);
  if (!fullName) throw new GuardrailError("BAD_REPO", "Enter a repository as owner/name or a GitHub URL");
  if (!(await repoExists(fullName))) throw new GuardrailError("REPO_NOT_FOUND", `${fullName} is not a public repository we can read`);
  const db = getDb();
  await db.insert(repos).values({ contractId, fullName, mode: "public_poll" }).onConflictDoNothing();
  await audit(db, { contractId, entity: "repo", entityId: fullName, action: "repo_connected", actor: "user", summary: `Connected ${fullName} as an evidence source` });
}

/** Poll one repo for newly merged PRs. Returns how many new evidence items were captured. */
export async function pollRepo(repoId: string): Promise<number> {
  const db = getDb();
  const [r] = await db.select().from(repos).where(eq(repos.id, repoId));
  if (!r) throw new NotFoundError("Repo");
  const prs = await fetchMergedPrs(r.fullName, { since: null, limit: 30 });
  let added = 0;
  for (const pr of prs) {
    const [exists] = await db
      .select({ id: evidence.id })
      .from(evidence)
      .where(and(eq(evidence.contractId, r.contractId), eq(evidence.type, "github_pr"), eq(evidence.ref, `${r.fullName}#${pr.number}`)));
    if (exists) continue;
    Object.assign(pr, await fetchPrFiles(r.fullName, pr.number));
    if (await addEvidence(r.contractId, prToEvidence(r.fullName, pr))) added++;
  }
  await db.update(repos).set({ lastPolledAt: new Date() }).where(eq(repos.id, repoId));
  return added;
}

/** GitHub webhook: pull_request closed+merged → evidence on every active contract watching that repo. */
export async function handleGithubPullRequest(payload: {
  action: string;
  pull_request: { number: number; title: string; body: string | null; html_url: string; merged: boolean; merged_at: string | null; user?: { login: string }; labels?: { name: string }[] };
  repository: { full_name: string };
}): Promise<number> {
  if (payload.action !== "closed" || !payload.pull_request.merged) return 0;
  const db = getDb();
  const fullName = payload.repository.full_name;
  const watching = await db.select().from(repos).where(eq(repos.fullName, fullName));
  if (!watching.length) return 0;
  const p = payload.pull_request;
  const pr: MergedPr = {
    number: p.number,
    title: p.title,
    body: p.body,
    url: p.html_url,
    mergedAt: p.merged_at ?? new Date().toISOString(),
    author: p.user?.login ?? null,
    labels: (p.labels ?? []).map((l) => l.name),
    ...(await fetchPrFiles(fullName, p.number)),
  };
  let n = 0;
  for (const r of watching) if (await addEvidence(r.contractId, prToEvidence(fullName, pr))) n++;
  return n;
}

/**
 * AI maps unmapped evidence → milestone with confidence + rationale. Proposals only: a human confirms.
 * Low-confidence results stay unassigned for manual mapping.
 */
export async function mapPendingEvidence(contractId?: string): Promise<number> {
  const db = getDb();
  const pending = await db
    .select()
    .from(evidence)
    .where(and(isNull(evidence.mappedAt), eq(evidence.status, "proposed"), contractId ? eq(evidence.contractId, contractId) : undefined))
    .limit(25);
  let n = 0;
  for (const ev of pending) {
    const [c] = await db.select().from(contracts).where(eq(contracts.id, ev.contractId));
    if (!c || c.status !== "active") continue;
    const ms = await db.select().from(milestones).where(eq(milestones.contractId, ev.contractId)).orderBy(asc(milestones.number));
    const meta = ev.meta as { body?: string; files?: string[]; labels?: string[] };
    let r;
    try {
      r = await mapEvidence(
        { type: ev.type, title: ev.title, url: ev.url, body: meta.body, files: meta.files, labels: meta.labels },
        ms.map((m) => ({ number: m.number, title: m.title, acceptanceCriteria: m.acceptanceCriteria, status: m.status })),
      );
    } catch (err) {
      await audit(db, { contractId: ev.contractId, entity: "evidence", entityId: ev.id, action: "mapping_failed", actor: "system", summary: `AI mapping failed: ${(err as Error).message}` });
      continue;
    }
    const gate = gateMapping(r);
    const target = gate.milestoneNumber != null ? ms.find((m) => m.number === gate.milestoneNumber) : undefined;
    await db
      .update(evidence)
      .set({
        milestoneId: target?.id ?? null,
        aiConfidence: r.confidence,
        aiRationale: r.rationale,
        aiSummary: r.summary,
        aiCriteria: r.criteriaMatched,
        mappedAt: new Date(),
      })
      .where(eq(evidence.id, ev.id));
    await audit(db, {
      contractId: ev.contractId,
      entity: "evidence",
      entityId: ev.id,
      action: "evidence_mapped",
      actor: r.by === "heuristic" ? "system" : "ai",
      summary: target
        ? `Proposed ${ev.title} → Milestone ${target.number} (${Math.round(r.confidence * 100)}% confidence)`
        : `Could not confidently map ${ev.title} (${Math.round(r.confidence * 100)}%) — needs manual mapping`,
      rationale: r.rationale,
      source: { evidence: ev.ref, url: ev.url, criteriaMatched: r.criteriaMatched, by: r.by },
    });
    n++;
  }
  return n;
}

async function ownedEvidence(userId: string, evidenceId: string): Promise<Evidence> {
  const [ev] = await getDb().select().from(evidence).where(eq(evidence.id, evidenceId));
  if (!ev) throw new NotFoundError("Evidence");
  await getContract(userId, ev.contractId);
  return ev;
}

/** Human decision on an evidence item: confirm (optionally re-assigning the milestone) or reject. */
export async function reviewEvidence(
  userId: string,
  evidenceId: string,
  decision: { action: "confirm"; milestoneId: string } | { action: "reject" } | { action: "unassign" },
): Promise<void> {
  const db = getDb();
  const ev = await ownedEvidence(userId, evidenceId);
  if (decision.action === "confirm") {
    const [m] = await db.select().from(milestones).where(and(eq(milestones.id, decision.milestoneId), eq(milestones.contractId, ev.contractId)));
    if (!m) throw new NotFoundError("Milestone");
    await db.update(evidence).set({ status: "confirmed", milestoneId: m.id, mappedAt: ev.mappedAt ?? new Date() }).where(eq(evidence.id, ev.id));
    const overrode = ev.milestoneId && ev.milestoneId !== m.id;
    await audit(db, {
      contractId: ev.contractId,
      entity: "evidence",
      entityId: ev.id,
      action: "evidence_confirmed",
      actor: "user",
      summary: `${overrode ? "Re-mapped and confirmed" : "Confirmed"} ${ev.title} → Milestone ${m.number}`,
    });
    await recomputeProgress(m.id);
    if (m.status === "planned") await db.update(milestones).set({ status: "in_progress" }).where(eq(milestones.id, m.id));
  } else if (decision.action === "reject") {
    await db.update(evidence).set({ status: "rejected" }).where(eq(evidence.id, ev.id));
    await audit(db, { contractId: ev.contractId, entity: "evidence", entityId: ev.id, action: "evidence_rejected", actor: "user", summary: `Rejected ${ev.title} as evidence` });
    if (ev.milestoneId) await recomputeProgress(ev.milestoneId);
  } else {
    await db.update(evidence).set({ status: "proposed", milestoneId: null }).where(eq(evidence.id, ev.id));
    if (ev.milestoneId) await recomputeProgress(ev.milestoneId);
  }
}

export async function recomputeProgress(milestoneId: string): Promise<void> {
  const db = getDb();
  const [m] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!m) return;
  const ev = await db
    .select()
    .from(evidence)
    .where(and(eq(evidence.milestoneId, milestoneId), eq(evidence.status, "confirmed")));
  const covered = new Set<string>();
  for (const e of ev) for (const c of e.aiCriteria ?? []) covered.add(c);
  // Evidence the freelancer attached manually counts as one criterion's worth if no AI criteria were recorded.
  const coveredCount = Math.max(covered.size, Math.min(ev.length, m.acceptanceCriteria.length));
  await db.update(milestones).set({ progress: milestoneProgress(m.status, m.acceptanceCriteria.length, coveredCount) }).where(eq(milestones.id, milestoneId));
}
