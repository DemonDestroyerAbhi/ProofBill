import {
  acceptanceDeadline,
  blockingDependencies,
  isAutoAcceptDue,
  toHoursX100,
  transition,
  type MilestoneStatus,
} from "@proofbill/core";
import { and, asc, contracts, eq, getDb, isNull, lte, milestones, timeEntries, type Milestone } from "@proofbill/db";
import { audit } from "./audit";
import { GuardrailError, NotFoundError, getContract } from "./contracts";
import { recomputeProgress } from "./evidence";

async function ownedMilestone(userId: string, milestoneId: string) {
  const [m] = await getDb().select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!m) throw new NotFoundError("Milestone");
  const c = await getContract(userId, m.contractId);
  return { m, c };
}

/** Freelancer marks complete → client review window starts. */
export async function submitMilestone(userId: string, milestoneId: string, note: string | null, now = new Date()): Promise<Milestone> {
  const { m, c } = await ownedMilestone(userId, milestoneId);
  if (c.status !== "active") throw new GuardrailError("NOT_ACTIVE", "Confirm the contract terms first");
  const db = getDb();
  const all = await db.select().from(milestones).where(eq(milestones.contractId, c.id));
  const blocking = blockingDependencies(
    { id: m.id, number: m.number, status: m.status as MilestoneStatus, dependsOn: m.dependsOn },
    all.map((x) => ({ id: x.id, number: x.number, status: x.status as MilestoneStatus, dependsOn: x.dependsOn })),
  );
  if (blocking.length)
    throw new GuardrailError("BLOCKED", `Milestone ${m.number} depends on Milestone ${blocking.map((b) => b.number).join(", ")}, which isn't accepted yet`);
  const status = transition(m.status as MilestoneStatus, "submit");
  const deadline = acceptanceDeadline(now, c.acceptanceWindowBizDays);
  const [u] = await db
    .update(milestones)
    .set({ status, submittedAt: now, submissionNote: note, acceptanceDeadline: deadline, rejectionReason: null })
    .where(and(eq(milestones.id, m.id), eq(milestones.status, m.status)))
    .returning();
  if (!u) throw new GuardrailError("CONFLICT", "Milestone changed — reload");
  await audit(db, {
    contractId: c.id,
    entity: "milestone",
    entityId: m.id,
    action: "submitted",
    actor: "user",
    summary: `Milestone ${m.number} marked complete; client has until ${deadline.toISOString().slice(0, 16).replace("T", " ")} UTC (${c.acceptanceWindowBizDays} business days) to accept or reject`,
    payload: { note },
  });
  await recomputeProgress(m.id);
  return u;
}

/** Client decision from the evidence portal. Token-scoped: the portal never exposes other contracts. */
export async function clientDecision(
  portalToken: string,
  milestoneId: string,
  decision: { action: "accept"; name?: string } | { action: "reject"; reason: string; name?: string },
  now = new Date(),
): Promise<Milestone> {
  const db = getDb();
  const [row] = await db
    .select({ m: milestones, c: contracts })
    .from(milestones)
    .innerJoin(contracts, eq(milestones.contractId, contracts.id))
    .where(and(eq(milestones.id, milestoneId), eq(contracts.portalToken, portalToken)));
  if (!row) throw new NotFoundError("Milestone");
  const { m, c } = row;
  if (decision.action === "reject" && decision.reason.trim().length < 5)
    throw new GuardrailError("REASON_REQUIRED", "Please give a reason so the freelancer can fix it");
  const status = transition(m.status as MilestoneStatus, decision.action);
  const [u] = await db
    .update(milestones)
    .set(
      decision.action === "accept"
        ? { status, acceptedAt: now, acceptedBy: "client" }
        : { status, rejectionReason: decision.reason.trim(), acceptanceDeadline: null },
    )
    .where(and(eq(milestones.id, m.id), eq(milestones.status, "submitted")))
    .returning();
  if (!u) throw new GuardrailError("CONFLICT", "This milestone was already decided");
  await audit(db, {
    contractId: c.id,
    entity: "milestone",
    entityId: m.id,
    action: decision.action === "accept" ? "accepted" : "rejected",
    actor: "client",
    summary:
      decision.action === "accept"
        ? `Client${decision.name ? ` (${decision.name})` : ""} accepted Milestone ${m.number}`
        : `Client${decision.name ? ` (${decision.name})` : ""} rejected Milestone ${m.number}: ${decision.reason.trim()}`,
  });
  await recomputeProgress(m.id);
  return u;
}

/** Contract: silence past the acceptance window = accepted. Run by the worker. */
export async function autoAcceptDue(now = new Date()): Promise<number> {
  const db = getDb();
  const due = await db
    .select()
    .from(milestones)
    .where(and(eq(milestones.status, "submitted"), lte(milestones.acceptanceDeadline, now)));
  let n = 0;
  for (const m of due) {
    if (!isAutoAcceptDue({ status: m.status as MilestoneStatus, acceptanceDeadline: m.acceptanceDeadline }, now)) continue;
    const [u] = await db
      .update(milestones)
      .set({ status: "accepted", acceptedAt: now, acceptedBy: "auto" })
      .where(and(eq(milestones.id, m.id), eq(milestones.status, "submitted")))
      .returning();
    if (!u) continue;
    const [c] = await db.select().from(contracts).where(eq(contracts.id, m.contractId));
    await audit(db, {
      contractId: m.contractId,
      entity: "milestone",
      entityId: m.id,
      action: "auto_accepted",
      actor: "system",
      summary: `Milestone ${m.number} auto-accepted: no response within ${c?.acceptanceWindowBizDays ?? "?"} business days`,
      rationale: "Contract acceptance clause: silence after the window counts as acceptance.",
      source: { acceptanceDeadline: m.acceptanceDeadline },
    });
    await recomputeProgress(m.id);
    n++;
  }
  return n;
}

/** Hours are user-entered only — never inferred from commits. */
export async function addTimeEntry(userId: string, milestoneId: string, e: { date: string; hours: number; note: string }): Promise<void> {
  const { m, c } = await ownedMilestone(userId, milestoneId);
  if (m.billing !== "hourly") throw new GuardrailError("NOT_HOURLY", "Time entries only apply to hourly milestones");
  if (!(e.hours > 0 && e.hours <= 24)) throw new GuardrailError("BAD_HOURS", "Hours must be between 0 and 24");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new GuardrailError("BAD_DATE", "Date must be YYYY-MM-DD");
  const db = getDb();
  await db.insert(timeEntries).values({ milestoneId, date: e.date, hoursX100: toHoursX100(e.hours), note: e.note });
  if (m.status === "planned") await db.update(milestones).set({ status: "in_progress" }).where(eq(milestones.id, m.id));
  await audit(db, { contractId: c.id, entity: "time_entry", entityId: m.id, action: "time_logged", actor: "user", summary: `Logged ${e.hours}h on Milestone ${m.number} (${e.date})${e.note ? `: ${e.note}` : ""}` });
}

export async function deleteTimeEntry(userId: string, entryId: string): Promise<void> {
  const db = getDb();
  const [t] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId));
  if (!t) throw new NotFoundError("Time entry");
  await ownedMilestone(userId, t.milestoneId);
  if (t.invoiceId) throw new GuardrailError("INVOICED", "That time is already on an invoice");
  await db.delete(timeEntries).where(and(eq(timeEntries.id, entryId), isNull(timeEntries.invoiceId)));
}

export async function unbilledTime(milestoneId: string) {
  return getDb()
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.milestoneId, milestoneId), isNull(timeEntries.invoiceId)))
    .orderBy(asc(timeEntries.date));
}
