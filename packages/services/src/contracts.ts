import { randomBytes } from "node:crypto";
import { extractTerms } from "@proofbill/ai";
import { toCents, validateTerms, type ConfirmedTerms, type ExtractedTerms, type TermsIssue } from "@proofbill/core";
import {
  and,
  asc,
  auditEvents,
  clients,
  contracts,
  desc,
  eq,
  evidence,
  getDb,
  invoiceLines,
  invoices,
  milestones,
  repos,
  timeEntries,
  inArray,
  sql,
  users,
  type Contract,
} from "@proofbill/db";
import { audit } from "./audit";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
  }
}

export class GuardrailError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function contractCode(name: string): string {
  const base = name.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4) || "CTR";
  return `${base}${randomBytes(2).toString("hex").toUpperCase()}`;
}

export async function createDraftFromText(userId: string, doc: { name: string; text: string }): Promise<Contract> {
  if (doc.text.trim().length < 40) throw new GuardrailError("EMPTY_DOC", "That document has no readable text");
  const { terms, by } = await extractTerms(doc.text, doc.name);
  const db = getDb();
  const c = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(contracts)
      .values({
        userId,
        code: contractCode(terms.clientName.value ?? terms.title.value),
        title: terms.title.value || doc.name,
        sourceDocName: doc.name,
        sourceText: doc.text,
        extracted: terms,
        extractedBy: by,
        portalToken: randomBytes(18).toString("base64url"),
        status: "draft",
      })
      .returning();
    const fields = Object.entries(terms).filter(([k, v]) => k !== "milestones" && (v as { value: unknown }).value != null).length;
    await audit(tx, {
      contractId: c!.id,
      entity: "contract",
      entityId: c!.id,
      action: "terms_extracted",
      actor: by === "heuristic" ? "system" : "ai",
      summary: `Extracted ${fields} terms and ${terms.milestones.length} milestones from ${doc.name} (${by})`,
      rationale: "Every field cites the clause it came from; awaiting freelancer review.",
      source: { document: doc.name },
      payload: terms,
    });
    return c!;
  });
  return c;
}

/** Pre-fill for the review form. Hourly change-request clauses on a fixed contract become an hourly milestone. */
export function extractedToConfirmed(t: ExtractedTerms): ConfirmedTerms {
  const ms: ConfirmedTerms["milestones"] = t.milestones.map((m) => ({
    title: m.title,
    acceptanceCriteria: m.acceptanceCriteria,
    amountCents: m.amount != null ? toCents(m.amount) : null,
    dueDate: m.dueDate,
    dependsOn: m.dependsOn,
    billing: t.rateType.value === "hourly" || m.amount == null ? "hourly" : "fixed",
  }));
  if (t.rateType.value === "fixed" && t.hourlyRate.value != null) {
    ms.push({
      title: "Change requests (hourly)",
      acceptanceCriteria: ["Work outside the fixed milestones, approved by the client"],
      amountCents: null,
      dueDate: null,
      dependsOn: [],
      billing: "hourly",
    });
  }
  return {
    title: t.title.value,
    clientName: t.clientName.value ?? "",
    clientEmail: t.clientEmail.value ?? "",
    currency: t.currency.value || "USD",
    rateType: t.rateType.value,
    hourlyRateCents: t.hourlyRate.value != null ? toCents(t.hourlyRate.value) : null,
    hourlyCapHours: t.hourlyCapHours.value,
    totalCapCents: t.totalCap.value != null ? toCents(t.totalCap.value) : null,
    netDays: t.netDays.value ?? 30,
    partialMinPct: t.partialMinPct.value,
    lateFeePctMonthly: t.lateFeePctMonthly.value,
    acceptanceWindowBizDays: t.acceptanceWindowBizDays.value ?? 5,
    milestones: ms,
  };
}

export async function getContract(userId: string, id: string): Promise<Contract> {
  const [c] = await getDb()
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, id), eq(contracts.userId, userId)));
  if (!c) throw new NotFoundError("Contract");
  return c;
}

export async function confirmContract(userId: string, id: string, terms: ConfirmedTerms): Promise<{ issues: TermsIssue[] }> {
  const issues = validateTerms(terms);
  if (issues.some((i) => i.level === "error")) return { issues };
  const c = await getContract(userId, id);
  if (c.status !== "draft") throw new GuardrailError("NOT_DRAFT", "Contract terms are already confirmed");
  const ai = c.extracted ? extractedToConfirmed(c.extracted as ExtractedTerms) : null;
  const edited = ai ? diffFields(ai, terms) : [];

  await getDb().transaction(async (tx) => {
    // Same client across contracts → reuse their record (matched by email, per freelancer).
    const [existingClient] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.userId, userId), sql`lower(${clients.email}) = ${terms.clientEmail.trim().toLowerCase()}`));
    const [client] = existingClient
      ? await tx.update(clients).set({ name: terms.clientName, currency: terms.currency }).where(eq(clients.id, existingClient.id)).returning()
      : await tx.insert(clients).values({ userId, name: terms.clientName, email: terms.clientEmail.trim(), currency: terms.currency }).returning();
    const extracted = c.extracted as ExtractedTerms | null;
    await tx
      .update(contracts)
      .set({
        clientId: client!.id,
        title: terms.title,
        rateType: terms.rateType,
        currency: terms.currency,
        hourlyRateCents: terms.hourlyRateCents,
        hourlyCapHours: terms.hourlyCapHours,
        totalCapCents: terms.totalCapCents,
        netDays: terms.netDays,
        partialMinPct: terms.partialMinPct,
        lateFeePctMonthly: terms.lateFeePctMonthly,
        acceptanceWindowBizDays: terms.acceptanceWindowBizDays,
        status: "active",
        confirmedAt: new Date(),
      })
      .where(eq(contracts.id, id));
    await tx.delete(milestones).where(eq(milestones.contractId, id));
    await tx.insert(milestones).values(
      terms.milestones.map((m, i) => ({
        contractId: id,
        number: i + 1,
        title: m.title,
        acceptanceCriteria: m.acceptanceCriteria,
        billing: m.billing,
        amountCents: m.billing === "fixed" ? m.amountCents : null,
        dueDate: m.dueDate,
        dependsOn: m.dependsOn,
        source: extracted?.milestones.find((x) => x.title === m.title)?.source ?? null,
      })),
    );
    await audit(tx, {
      contractId: id,
      entity: "contract",
      entityId: id,
      action: "terms_confirmed",
      actor: "user",
      summary: edited.length
        ? `Freelancer confirmed terms, editing ${edited.length} AI-proposed field(s): ${edited.join(", ")}`
        : "Freelancer confirmed AI-proposed terms without changes",
      payload: terms,
    });
  });
  return { issues };
}

function diffFields(a: ConfirmedTerms, b: ConfirmedTerms): string[] {
  const out: string[] = [];
  for (const k of Object.keys(a) as (keyof ConfirmedTerms)[]) {
    if (k === "milestones") continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  if (JSON.stringify(a.milestones) !== JSON.stringify(b.milestones)) out.push("milestones");
  return out;
}

export async function deleteDraft(userId: string, id: string): Promise<void> {
  const c = await getContract(userId, id);
  if (c.status !== "draft") throw new GuardrailError("NOT_DRAFT", "Only draft contracts can be deleted");
  await getDb().delete(contracts).where(eq(contracts.id, id));
}

export async function listContracts(userId: string) {
  const db = getDb();
  const cs = await db.select().from(contracts).where(eq(contracts.userId, userId)).orderBy(desc(contracts.createdAt));
  if (!cs.length) return [];
  const ids = cs.map((c) => c.id);
  const [ms, invs, cls] = await Promise.all([
    db.select().from(milestones).where(inArray(milestones.contractId, ids)),
    db.select().from(invoices).where(inArray(invoices.contractId, ids)),
    db.select().from(clients).where(eq(clients.userId, userId)),
  ]);
  return cs.map((c) => {
    const cm = ms.filter((m) => m.contractId === c.id);
    const ci = invs.filter((i) => i.contractId === c.id && i.status !== "CANCELLED" && i.status !== "draft");
    return {
      contract: c,
      client: cls.find((x) => x.id === c.clientId) ?? null,
      milestones: cm.length,
      accepted: cm.filter((m) => ["accepted", "invoiced", "paid"].includes(m.status)).length,
      awaitingClient: cm.filter((m) => m.status === "submitted").length,
      invoicedCents: ci.reduce((s, i) => s + i.amountCents, 0),
      paidCents: ci.reduce((s, i) => s + i.paidCents, 0),
    };
  });
}

/** Everything the contract page / portal needs, in one round trip set. */
export async function loadContractBundle(contractId: string) {
  const db = getDb();
  const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!c) throw new NotFoundError("Contract");
  const [client] = c.clientId ? await db.select().from(clients).where(eq(clients.id, c.clientId)) : [];
  const ms = await db.select().from(milestones).where(eq(milestones.contractId, contractId)).orderBy(asc(milestones.number));
  const msIds = ms.map((m) => m.id);
  const [ev, rp, te, inv, au] = await Promise.all([
    db.select().from(evidence).where(eq(evidence.contractId, contractId)).orderBy(desc(evidence.capturedAt)),
    db.select().from(repos).where(eq(repos.contractId, contractId)),
    msIds.length ? db.select().from(timeEntries).where(inArray(timeEntries.milestoneId, msIds)).orderBy(asc(timeEntries.date)) : Promise.resolve([]),
    db.select().from(invoices).where(eq(invoices.contractId, contractId)).orderBy(asc(invoices.createdAt)),
    db.select().from(auditEvents).where(eq(auditEvents.contractId, contractId)).orderBy(desc(auditEvents.at)).limit(200),
  ]);
  const lines = inv.length
    ? await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, inv.map((i) => i.id))).orderBy(asc(invoiceLines.position))
    : [];
  return { contract: c, client: client ?? null, milestones: ms, evidence: ev, repos: rp, timeEntries: te, invoices: inv, lines, audit: au };
}
export type ContractBundle = Awaited<ReturnType<typeof loadContractBundle>>;

export async function contractByPortalToken(token: string): Promise<Contract | null> {
  const [c] = await getDb().select().from(contracts).where(eq(contracts.portalToken, token));
  return c && c.status !== "draft" ? c : null;
}

/** Name shown to the client (portal, reminders): the owner's display name (Settings), else their GitHub login. */
export async function freelancerDisplayName(contract: Pick<Contract, "userId">): Promise<string> {
  const [u] = await getDb().select().from(users).where(eq(users.id, contract.userId));
  return u?.name || u?.login || "Your freelancer";
}
