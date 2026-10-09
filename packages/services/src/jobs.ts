import { getDb, lt, or, isNull, repos, contracts, eq, and } from "@proofbill/db";
import { mapPendingEvidence, pollRepo } from "./evidence";
import { autoAcceptDue } from "./milestones";

/** Worker tick: poll public repos, map new evidence, auto-accept past the acceptance window. */
export async function workerTick(now = new Date(), opts: { pollEveryMs?: number } = {}) {
  const db = getDb();
  const cutoff = new Date(now.getTime() - (opts.pollEveryMs ?? 5 * 60_000));
  const due = await db
    .select({ id: repos.id, fullName: repos.fullName })
    .from(repos)
    .innerJoin(contracts, eq(repos.contractId, contracts.id))
    .where(and(eq(contracts.status, "active"), or(isNull(repos.lastPolledAt), lt(repos.lastPolledAt, cutoff))));
  let polled = 0;
  const errors: string[] = [];
  for (const r of due) {
    try {
      polled += await pollRepo(r.id);
    } catch (e) {
      errors.push(`${r.fullName}: ${(e as Error).message}`);
    }
  }
  const mapped = await mapPendingEvidence();
  const autoAccepted = await autoAcceptDue(now);
  return { polled, mapped, autoAccepted, errors };
}
