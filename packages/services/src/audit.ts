import { auditEvents, type DbOrTx } from "@proofbill/db";

export interface AuditInput {
  contractId: string | null;
  entity: string;
  entityId: string;
  action: string;
  actor: "user" | "client" | "ai" | "system";
  summary: string;
  rationale?: string | null;
  source?: unknown;
  payload?: unknown;
}

/** Everything that changes state — and everything the AI proposed — lands here with rationale + source. */
export async function audit(db: DbOrTx, e: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    contractId: e.contractId,
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    actor: e.actor,
    summary: e.summary,
    rationale: e.rationale ?? null,
    source: e.source ?? null,
    payload: e.payload ?? null,
  });
}
