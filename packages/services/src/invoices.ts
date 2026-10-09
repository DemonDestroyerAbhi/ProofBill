import { writeInvoiceLines, writeReminder } from "@proofbill/ai";
import {
  addDays,
  assertWithinCap,
  centsToString,
  countsTowardsCap,
  daysBetween,
  dueLateFees,
  formatDate,
  invoiceNumber,
  isOpenStatus,
  isPaidStatus,
  isReminderDue,
  lateFeeInvoiceNumber,
  minimumPaymentCents,
  netTermType,
  parseDate,
  paypalRequestId,
  priceMilestone,
  transition,
  type MilestoneStatus,
} from "@proofbill/core";
import {
  and,
  asc,
  clients,
  contracts,
  eq,
  evidence,
  getDb,
  inArray,
  invoiceLines,
  invoices,
  milestones,
  ne,
  sql,
  timeEntries,
  webhookEvents,
  type Contract,
  type Invoice,
} from "@proofbill/db";
import { buildInvoiceBody, moneyToCents, payerLink, PayPalApiError, DUPLICATE_INVOICE_MOCK, type PayPalInvoice } from "@proofbill/paypal";
import { audit } from "./audit";
import { GuardrailError, NotFoundError, freelancerDisplayName, getContract } from "./contracts";
import { portalUrl } from "./env";
import { unbilledTime } from "./milestones";
import { MockInvoicing, invoicing } from "./paypal";
import { reconcileOutstanding, tryReconcile } from "./reconcile";

/** Sum of every live (non-cancelled) milestone invoice on the contract — what the cap is measured against. */
async function billingHistory(contractId: string, excludeInvoiceId?: string) {
  const rows = await getDb()
    .select()
    .from(invoices)
    .where(and(eq(invoices.contractId, contractId), eq(invoices.kind, "milestone")));
  const live = rows.filter((i) => countsTowardsCap(i.status) && i.id !== excludeInvoiceId);
  const lineRows = live.length
    ? await getDb().select().from(invoiceLines).where(and(inArray(invoiceLines.invoiceId, live.map((i) => i.id)), eq(invoiceLines.unitOfMeasure, "HOURS")))
    : [];
  return {
    invoicedCents: live.reduce((s, i) => s + i.amountCents, 0),
    invoicedHoursX100: lineRows.reduce((s, l) => s + Math.round(Number(l.quantity) * 100), 0),
  };
}

/**
 * Accepted milestone → draft invoice. Amount computed in @proofbill/core from contract terms; AI only
 * writes the line descriptions + note. Nothing goes to PayPal until the freelancer approves.
 */
export async function buildInvoiceDraft(userId: string, milestoneId: string): Promise<Invoice> {
  const db = getDb();
  const [m] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!m) throw new NotFoundError("Milestone");
  const c = await getContract(userId, m.contractId);
  if (m.status !== "accepted") throw new GuardrailError("NOT_ACCEPTED", "Only client-accepted milestones can be invoiced");

  const [existing] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.milestoneId, m.id), eq(invoices.kind, "milestone"), ne(invoices.status, "CANCELLED")));
  if (existing) return existing;

  const entries = m.billing === "hourly" ? await unbilledTime(m.id) : [];
  const priced = priceMilestone(
    { rateType: c.rateType, hourlyRateCents: c.hourlyRateCents, hourlyCapHours: c.hourlyCapHours, totalCapCents: c.totalCapCents, partialMinPct: c.partialMinPct },
    { number: m.number, title: m.title, billing: m.billing, amountCents: m.amountCents },
    entries.map((e) => ({ id: e.id, date: e.date, hoursX100: e.hoursX100, note: e.note })),
    await billingHistory(c.id),
  );
  if (!priced.ok) {
    await audit(db, { contractId: c.id, entity: "milestone", entityId: m.id, action: "invoice_blocked", actor: "system", summary: `Invoice blocked (${priced.code}): ${priced.message}` });
    throw new GuardrailError(priced.code, priced.message);
  }

  const ev = await db
    .select()
    .from(evidence)
    .where(and(eq(evidence.milestoneId, m.id), eq(evidence.status, "confirmed")))
    .orderBy(asc(evidence.capturedAt));
  const [client] = c.clientId ? await db.select().from(clients).where(eq(clients.id, c.clientId)) : [];
  let written;
  try {
    written = await writeInvoiceLines({
      clientName: client?.name ?? "Client",
      milestone: { number: m.number, title: m.title, acceptanceCriteria: m.acceptanceCriteria, acceptedBy: m.acceptedBy },
      lines: priced.lines.map((l) => ({ key: l.key, name: l.name, unitOfMeasure: l.unitOfMeasure, quantity: l.quantity })),
      evidence: ev.map((e) => ({ id: e.id, title: e.title, url: e.url, summary: e.aiSummary })),
      timeNotes: entries.map((e) => e.note).filter(Boolean),
    });
  } catch (err) {
    const { templateLines } = await import("@proofbill/ai");
    written = {
      ...templateLines({
        milestone: { number: m.number, title: m.title, acceptanceCriteria: m.acceptanceCriteria, acceptedBy: m.acceptedBy },
        lines: priced.lines.map((l) => ({ key: l.key, name: l.name, unitOfMeasure: l.unitOfMeasure, quantity: l.quantity })),
        evidence: ev.map((e) => ({ id: e.id, title: e.title, url: e.url, summary: e.aiSummary })),
      }),
      by: "template",
      rejected: `AI unavailable: ${(err as Error).message}`,
    };
  }

  return db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(invoices)
      .values({
        contractId: c.id,
        milestoneId: m.id,
        kind: "milestone",
        number: invoiceNumber(c.code, m.number),
        amountCents: priced.totalCents,
        minimumPaymentCents: priced.minimumPaymentCents,
        currency: c.currency,
        status: "draft",
        note: written.note,
      })
      .returning();
    await tx.insert(invoiceLines).values(
      priced.lines.map((l, i) => {
        const w = written.lines.find((x) => x.key === l.key);
        return {
          invoiceId: inv!.id,
          position: i,
          name: l.name,
          description: w?.description ?? "",
          quantity: l.quantity,
          unitOfMeasure: l.unitOfMeasure,
          unitAmountCents: l.unitAmountCents,
          totalCents: l.totalCents,
          evidenceIds: w?.evidenceIds ?? [],
          descriptionBy: written.by === "template" ? ("system" as const) : ("ai" as const),
        };
      }),
    );
    if (entries.length) await tx.update(timeEntries).set({ invoiceId: inv!.id }).where(inArray(timeEntries.id, entries.map((e) => e.id)));
    await audit(tx, {
      contractId: c.id,
      entity: "invoice",
      entityId: inv!.id,
      action: "draft_built",
      actor: "system",
      summary: `Draft ${inv!.number}: ${centsToString(priced.totalCents)} ${c.currency} computed from contract terms${
        priced.remainingCapCents != null ? ` (cap remaining after: ${centsToString(priced.remainingCapCents)})` : ""
      }`,
      payload: { lines: priced.lines, minimumPaymentCents: priced.minimumPaymentCents },
    });
    await audit(tx, {
      contractId: c.id,
      entity: "invoice",
      entityId: inv!.id,
      action: "lines_written",
      actor: written.by === "template" ? "system" : "ai",
      summary: written.by === "template" ? "Line descriptions from template" : `AI wrote ${priced.lines.length} line description(s) and the invoice note`,
      rationale: written.rejected ?? "Descriptions cite confirmed evidence only; amounts are not AI-generated.",
      source: { evidence: ev.map((e) => e.ref), by: written.by },
    });
    return inv!;
  });
}

async function ownedInvoice(userId: string, invoiceId: string) {
  const [inv] = await getDb().select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new NotFoundError("Invoice");
  const c = await getContract(userId, inv.contractId);
  return { inv, c };
}

export async function updateDraftText(userId: string, invoiceId: string, edits: { note?: string; lines?: { id: string; description: string }[] }): Promise<void> {
  const { inv, c } = await ownedInvoice(userId, invoiceId);
  if (inv.status !== "draft") throw new GuardrailError("NOT_DRAFT", "Only drafts can be edited");
  const db = getDb();
  if (edits.note != null) await db.update(invoices).set({ note: edits.note, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  for (const l of edits.lines ?? [])
    await db
      .update(invoiceLines)
      .set({ description: l.description, descriptionBy: "user" })
      .where(and(eq(invoiceLines.id, l.id), eq(invoiceLines.invoiceId, inv.id)));
  await audit(db, { contractId: c.id, entity: "invoice", entityId: inv.id, action: "draft_edited", actor: "user", summary: `Freelancer edited draft ${inv.number} text` });
}

export async function discardDraft(userId: string, invoiceId: string): Promise<void> {
  const { inv, c } = await ownedInvoice(userId, invoiceId);
  if (inv.status !== "draft" && inv.status !== "send_failed") throw new GuardrailError("NOT_DRAFT", "Only unsent drafts can be discarded");
  if (inv.paypalInvoiceId) throw new GuardrailError("ON_PAYPAL", "This invoice exists on PayPal — cancel it instead");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(timeEntries).set({ invoiceId: null }).where(eq(timeEntries.invoiceId, inv.id));
    await tx.delete(invoices).where(eq(invoices.id, inv.id));
    await audit(tx, { contractId: c.id, entity: "invoice", entityId: inv.id, action: "draft_discarded", actor: "user", summary: `Discarded draft ${inv.number}` });
  });
}

function payPalBody(c: Contract, inv: Invoice, lines: (typeof invoiceLines.$inferSelect)[], client: { name: string; email: string }, today: Date) {
  return buildInvoiceBody({
    number: inv.number,
    currency: inv.currency,
    invoiceDate: formatDate(today),
    termType: inv.kind === "late_fee" ? "DUE_ON_RECEIPT" : netTermType(c.netDays),
    recipientEmail: client.email,
    recipientName: client.name,
    reference: `${c.title} · ${c.code}`,
    note: `${inv.note ?? ""}\n\nEvidence & acceptance record: ${portalUrl(c.portalToken)}`.trim(),
    terms: [
      `Payable Net ${c.netDays}.`,
      c.partialMinPct ? `Partial payments accepted; minimum ${c.partialMinPct}% of the invoice.` : null,
      c.lateFeePctMonthly ? `Overdue balances accrue ${c.lateFeePctMonthly}% per month.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    items: lines.map((l) => ({
      name: l.name,
      description: [l.description].filter(Boolean).join(" "),
      quantity: l.quantity,
      unitAmount: centsToString(l.unitAmountCents),
      unitOfMeasure: l.unitOfMeasure as "AMOUNT" | "HOURS",
    })),
    minimumAmountDue: inv.minimumPaymentCents != null ? centsToString(inv.minimumPaymentCents) : null,
  });
}

/**
 * Freelancer approves → create + send on PayPal. Idempotent end to end:
 *  - claim the row (draft|send_failed → sending) so double-clicks / retries can't race
 *  - PayPal-Request-Id derived from our invoice id; unique invoice number on both sides
 *  - DUPLICATE_INVOICE_ID ⇒ we created it earlier and crashed: adopt the existing PayPal invoice
 *  - cap re-checked at send time against everything else on the contract
 */
export async function approveAndSend(userId: string, invoiceId: string, opts: { now?: Date } = {}): Promise<Invoice> {
  const now = opts.now ?? new Date();
  const { inv, c } = await ownedInvoice(userId, invoiceId);
  return sendInvoiceInternal(c, inv, now, "user");
}

async function sendInvoiceInternal(c: Contract, inv: Invoice, now: Date, actor: "user" | "system"): Promise<Invoice> {
  const db = getDb();
  if (inv.kind === "milestone") {
    const hist = await billingHistory(c.id, inv.id);
    try {
      assertWithinCap(c, hist.invoicedCents, inv.amountCents);
    } catch (e) {
      await audit(db, { contractId: c.id, entity: "invoice", entityId: inv.id, action: "send_blocked", actor: "system", summary: (e as Error).message });
      throw new GuardrailError("OVER_CAP", (e as Error).message);
    }
  }
  const [claimed] = await db
    .update(invoices)
    .set({ status: "sending", updatedAt: now, approvedAt: inv.approvedAt ?? now })
    .where(
      and(
        eq(invoices.id, inv.id),
        sql`(${invoices.status} IN ('draft','send_failed') OR (${invoices.status} = 'sending' AND ${invoices.updatedAt} < now() - interval '2 minutes'))`,
      ),
    )
    .returning();
  if (!claimed) throw new GuardrailError("ALREADY_SENDING", "This invoice is already being sent or was sent");
  await audit(db, { contractId: c.id, entity: "invoice", entityId: inv.id, action: "approved", actor, summary: `${actor === "user" ? "Freelancer approved" : "System issued"} ${inv.number} for sending via PayPal` });

  const pp = invoicing();
  try {
    const [client] = c.clientId ? await db.select().from(clients).where(eq(clients.id, c.clientId)) : [];
    if (!client) throw new GuardrailError("NO_CLIENT", "Contract has no client");
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.position));

    let ppInv: PayPalInvoice | null = claimed.paypalInvoiceId ? await pp.getInvoice(claimed.paypalInvoiceId) : null;
    if (!ppInv) {
      try {
        ppInv = await pp.createInvoice(payPalBody(c, claimed, lines, client, now), { requestId: paypalRequestId("create", inv.id) });
      } catch (e) {
        if (e instanceof PayPalApiError && e.isDuplicateInvoiceNumber) {
          ppInv = await pp.findInvoiceByNumber(inv.number);
          if (!ppInv) throw e;
          await audit(db, { contractId: c.id, entity: "invoice", entityId: inv.id, action: "duplicate_recovered", actor: "system", summary: `PayPal reported DUPLICATE_INVOICE_ID for ${inv.number}; adopted existing PayPal invoice ${ppInv.id} instead of creating another` });
        } else throw e;
      }
      await db.update(invoices).set({ paypalInvoiceId: ppInv.id, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
    }

    let href: string | undefined;
    if (ppInv.status === "DRAFT") {
      href = (await pp.sendInvoice(ppInv.id, { subject: `Invoice ${inv.number} — ${c.title}`, note: undefined }, { requestId: paypalRequestId("send", inv.id) })).href;
    }
    const fresh = await pp.getInvoice(ppInv.id);
    const dueDate = fresh.detail.payment_term?.due_date ?? formatDate(addDays(now, inv.kind === "late_fee" ? 0 : c.netDays));
    const [sent] = await db
      .update(invoices)
      .set({
        status: fresh.status === "DRAFT" ? "SENT" : fresh.status,
        payerViewUrl: payerLink(href, fresh),
        sentAt: now,
        dueDate,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id))
      .returning();
    if (inv.milestoneId && inv.kind === "milestone") {
      const [m] = await db.select().from(milestones).where(eq(milestones.id, inv.milestoneId));
      if (m && m.status === "accepted") await db.update(milestones).set({ status: transition("accepted", "invoice") }).where(eq(milestones.id, m.id));
    }
    await audit(db, {
      contractId: c.id,
      entity: "invoice",
      entityId: inv.id,
      action: "sent",
      actor: "system",
      summary: `Sent ${inv.number} via PayPal Invoicing (${pp.mode}) — ${centsToString(inv.amountCents)} ${inv.currency}, due ${dueDate}`,
      source: { paypalInvoiceId: ppInv.id, payerViewUrl: sent!.payerViewUrl },
    });
    return sent!;
  } catch (e) {
    await db.update(invoices).set({ status: "send_failed", updatedAt: new Date() }).where(eq(invoices.id, inv.id));
    await audit(db, { contractId: c.id, entity: "invoice", entityId: inv.id, action: "send_failed", actor: "system", summary: `Sending ${inv.number} failed: ${(e as Error).message}` });
    throw e;
  }
}

/** Pull the PayPal invoice and mirror status/paid amount. PayPal is the source of truth for money. */
export async function syncInvoiceFromPayPal(invoiceId: string, cause: string): Promise<Invoice | null> {
  const db = getDb();
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv?.paypalInvoiceId) return null;
  const pp = await invoicing().getInvoice(inv.paypalInvoiceId);
  const paidCents = moneyToCents(pp.payments?.paid_amount);
  if (pp.status === inv.status && paidCents === inv.paidCents) return inv;
  const [u] = await db
    .update(invoices)
    .set({
      status: pp.status,
      paidCents,
      paidAt: isPaidStatus(pp.status) ? inv.paidAt ?? new Date() : inv.paidAt,
      dueDate: pp.detail.payment_term?.due_date ?? inv.dueDate,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, inv.id))
    .returning();
  if (inv.milestoneId && inv.kind === "milestone") {
    if (isPaidStatus(pp.status)) await db.update(milestones).set({ status: "paid" }).where(and(eq(milestones.id, inv.milestoneId), eq(milestones.status, "invoiced")));
    if (pp.status === "CANCELLED") await db.update(milestones).set({ status: "accepted" }).where(and(eq(milestones.id, inv.milestoneId), eq(milestones.status, "invoiced")));
  }
  await audit(db, {
    contractId: inv.contractId,
    entity: "invoice",
    entityId: inv.id,
    action: "status_synced",
    actor: "system",
    summary: `${inv.number}: ${inv.status} → ${pp.status}, paid ${centsToString(paidCents)} of ${centsToString(inv.amountCents)} ${inv.currency} (${cause})`,
    source: { paypalInvoiceId: inv.paypalInvoiceId },
  });
  if (paidCents > inv.paidCents) await tryReconcile(inv.id);
  return u!;
}

export interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource?: { id?: string; invoice?: { id?: string } } & Record<string, unknown>;
}

/** Verified, deduped webhook processing. Returns what happened for logging. */
export async function handlePayPalWebhook(event: PayPalWebhookEvent, verified: boolean): Promise<"duplicate" | "unverified" | "ignored" | "processed"> {
  const db = getDb();
  // Dedupe on *processed* events only. PayPal retries non-2xx deliveries (up to 25 times over 3 days),
  // so a delivery that failed verification or errored mid-processing must be processed on retry.
  const id = `paypal:${event.id}`;
  const [prior] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id));
  if (prior?.processedAt) return "duplicate";
  const [stored] = prior
    ? await db.update(webhookEvents).set({ verified: prior.verified || verified, payload: event, error: null }).where(eq(webhookEvents.id, id)).returning()
    : await db
        .insert(webhookEvents)
        .values({ id, provider: "paypal", eventType: event.event_type, verified, payload: event })
        .onConflictDoNothing()
        .returning();
  if (!stored) return "duplicate"; // a concurrent delivery of the same event won the insert
  if (!verified) return "unverified";
  if (!event.event_type.startsWith("INVOICING.INVOICE.")) {
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, stored.id));
    return "ignored";
  }
  const ppId = event.resource?.invoice?.id ?? event.resource?.id;
  const [inv] = ppId ? await db.select().from(invoices).where(eq(invoices.paypalInvoiceId, ppId)) : [];
  if (!inv) {
    await db.update(webhookEvents).set({ processedAt: new Date(), error: "unknown invoice" }).where(eq(webhookEvents.id, stored.id));
    return "ignored";
  }
  try {
    await syncInvoiceFromPayPal(inv.id, `webhook ${event.event_type}`);
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, stored.id));
    return "processed";
  } catch (e) {
    await db.update(webhookEvents).set({ error: (e as Error).message }).where(eq(webhookEvents.id, stored.id));
    throw e;
  }
}

/** Offline simulator: payer pays → same webhook path a real PayPal event takes. */
export async function simulatePayment(paypalInvoiceId: string, cents: number): Promise<void> {
  const pp = invoicing();
  if (!(pp instanceof MockInvoicing)) throw new GuardrailError("NOT_MOCK", "Simulated payments only exist in mock mode — pay with the sandbox personal account");
  const r = await pp.pay(paypalInvoiceId, cents);
  await handlePayPalWebhook(
    {
      id: `MOCK-${paypalInvoiceId}-${r.paidCents}`,
      event_type: r.status === "PAID" ? "INVOICING.INVOICE.PAID" : "INVOICING.INVOICE.UPDATED",
      resource: { invoice: { id: paypalInvoiceId } },
    },
    true,
  );
}

export async function cancelInvoice(userId: string, invoiceId: string): Promise<void> {
  const { inv, c } = await ownedInvoice(userId, invoiceId);
  if (!inv.paypalInvoiceId) throw new GuardrailError("NOT_ON_PAYPAL", "Discard the draft instead");
  if (inv.paidCents > 0) throw new GuardrailError("HAS_PAYMENTS", "Invoices with payments can't be cancelled");
  await invoicing().cancelInvoice(inv.paypalInvoiceId, { subject: `Invoice ${inv.number} cancelled`, note: "This invoice has been cancelled." }, { requestId: paypalRequestId("cancel", inv.id) });
  await getDb().update(timeEntries).set({ invoiceId: null }).where(eq(timeEntries.invoiceId, inv.id));
  await audit(getDb(), { contractId: c.id, entity: "invoice", entityId: inv.id, action: "cancelled", actor: "user", summary: `Cancelled ${inv.number} on PayPal` });
  await syncInvoiceFromPayPal(inv.id, "cancelled by freelancer");
}

/** One reminder with an AI-written, tone-matched note via PayPal remind. */
export async function sendReminder(invoiceId: string, actor: "user" | "system", now = new Date()): Promise<{ subject: string; note: string; tone: string }> {
  const db = getDb();
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv?.paypalInvoiceId) throw new NotFoundError("Invoice");
  if (!isOpenStatus(inv.status)) throw new GuardrailError("NOT_OPEN", `Invoice is ${inv.status}`);
  const [c] = await db.select().from(contracts).where(eq(contracts.id, inv.contractId));
  const [client] = c?.clientId ? await db.select().from(clients).where(eq(clients.id, c.clientId)) : [];
  const [m] = inv.milestoneId ? await db.select().from(milestones).where(eq(milestones.id, inv.milestoneId)) : [];
  const daysOverdue = inv.dueDate ? Math.max(0, daysBetween(parseDate(inv.dueDate), now)) : 0;
  const ctx = {
    clientName: client?.name ?? "there",
    freelancerName: c ? await freelancerDisplayName(c) : "Your freelancer",
    invoiceNumber: inv.number,
    milestoneTitle: m?.title ?? (inv.kind === "late_fee" ? "late fee" : "services"),
    daysOverdue,
    reminderCount: inv.reminderCount,
    partiallyPaid: inv.paidCents > 0,
    acceptedBy: m?.acceptedBy ?? null,
    lateFeePctMonthly: c?.lateFeePctMonthly ?? null,
  };
  let r;
  try {
    r = await writeReminder(ctx);
  } catch (e) {
    const { templateReminder } = await import("@proofbill/ai");
    r = { ...templateReminder(ctx), by: "template", rationale: `AI unavailable: ${(e as Error).message}` };
  }
  await invoicing().remindInvoice(inv.paypalInvoiceId, { subject: r.subject, note: r.note }, { requestId: paypalRequestId("remind", inv.id, String(inv.reminderCount + 1)) });
  await db.update(invoices).set({ lastReminderAt: now, reminderCount: inv.reminderCount + 1, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  await audit(db, {
    contractId: inv.contractId,
    entity: "invoice",
    entityId: inv.id,
    action: "reminder_sent",
    actor: r.by === "template" ? actor : "ai",
    summary: `Reminder #${inv.reminderCount + 1} (${r.tone}) sent for ${inv.number}, ${daysOverdue} days overdue: "${r.subject}"`,
    rationale: r.rationale,
    payload: { subject: r.subject, note: r.note, by: r.by },
  });
  return r;
}

/** Cron: overdue reminders (1 day overdue, then weekly) + late-fee invoices per the contract. */
export async function runCollections(
  now = new Date(),
): Promise<{ reminders: number; lateFees: number; synced: number; reconciled: number; errors: string[] }> {
  const db = getDb();
  const open = await db
    .select()
    .from(invoices)
    .where(sql`${invoices.status} IN ('SENT','PARTIALLY_PAID','UNPAID','PAYMENT_PENDING') AND ${invoices.paypalInvoiceId} IS NOT NULL`);
  const out = { reminders: 0, lateFees: 0, synced: 0, reconciled: 0, errors: [] as string[] };
  for (const inv0 of open) {
    try {
      // Webhooks are primary; this is the safety net if one was missed.
      const inv = (await syncInvoiceFromPayPal(inv0.id, "collections sync")) ?? inv0;
      if (inv.status !== inv0.status || inv.paidCents !== inv0.paidCents) out.synced++;
      if (!isOpenStatus(inv.status) || !inv.dueDate) continue;
      const due = parseDate(inv.dueDate);
      if (isReminderDue({ dueDate: due, now, lastReminderAt: inv.lastReminderAt })) {
        await sendReminder(inv.id, "system", now);
        out.reminders++;
      }
      if (inv.kind === "milestone") out.lateFees += await assessLateFees(inv, now);
    } catch (e) {
      out.errors.push(`${inv0.number}: ${(e as Error).message}`);
    }
  }
  const rec = await reconcileOutstanding(now);
  out.reconciled = rec.matched;
  out.errors.push(...rec.errors);
  return out;
}

async function assessLateFees(inv: Invoice, now: Date): Promise<number> {
  const db = getDb();
  const [c] = await db.select().from(contracts).where(eq(contracts.id, inv.contractId));
  if (!c?.lateFeePctMonthly || !inv.dueDate) return 0;
  const prior = await db.select().from(invoices).where(eq(invoices.parentInvoiceId, inv.id));
  const decisions = dueLateFees({
    dueDate: parseDate(inv.dueDate),
    now,
    outstandingCents: inv.amountCents - inv.paidCents,
    pctMonthly: c.lateFeePctMonthly,
    assessedPeriods: prior.map((p) => p.lateFeePeriod ?? 0),
  });
  let n = 0;
  for (const d of decisions) {
    const [fee] = await db
      .insert(invoices)
      .values({
        contractId: c.id,
        milestoneId: inv.milestoneId,
        kind: "late_fee",
        parentInvoiceId: inv.id,
        lateFeePeriod: d.period,
        number: lateFeeInvoiceNumber(inv.number, d.period),
        amountCents: d.amountCents,
        currency: inv.currency,
        status: "draft",
        note: `Late fee for invoice ${inv.number}, month ${d.period} overdue, per the contract's late-fee clause (${c.lateFeePctMonthly}% per month on the outstanding balance).`,
      })
      .onConflictDoNothing()
      .returning();
    if (!fee) continue;
    await db.insert(invoiceLines).values({
      invoiceId: fee.id,
      position: 0,
      name: `Late fee — ${inv.number} (month ${d.period})`,
      description: `${c.lateFeePctMonthly}% of the outstanding balance of ${centsToString(inv.amountCents - inv.paidCents)} ${inv.currency}`,
      quantity: "1",
      unitOfMeasure: "AMOUNT",
      unitAmountCents: d.amountCents,
      totalCents: d.amountCents,
      descriptionBy: "system",
    });
    await audit(db, {
      contractId: c.id,
      entity: "invoice",
      entityId: fee.id,
      action: "late_fee_assessed",
      actor: "system",
      summary: `Late fee ${fee.number}: ${centsToString(d.amountCents)} ${inv.currency} (${c.lateFeePctMonthly}%/mo × outstanding ${centsToString(inv.amountCents - inv.paidCents)})`,
      rationale: "Contract late-fee clause; computed in code, simple interest per full 30 days overdue.",
    });
    await sendInvoiceInternal(c, fee, now, "system");
    n++;
  }
  return n;
}

/**
 * Guardrail demo: re-submit an already-sent invoice number to PayPal.
 * Sandbox: uses PayPal Negative Testing (PayPal-Mock-Response: DUPLICATE_INVOICE_ID) — needs the toggle on the account.
 * Mock: the simulator rejects the reused number the same way.
 */
export async function duplicateInvoiceProbe(userId: string, invoiceId: string): Promise<{ status: number; issue: string | undefined; message: string }> {
  const { inv, c } = await ownedInvoice(userId, invoiceId);
  const db = getDb();
  const [client] = c.clientId ? await db.select().from(clients).where(eq(clients.id, c.clientId)) : [];
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
  try {
    await invoicing().createInvoice(payPalBody(c, inv, lines, client!, new Date()), {
      requestId: `pb-dupe-probe-${inv.id}-${Date.now()}`,
      mockResponse: DUPLICATE_INVOICE_MOCK,
    });
    await audit(db, { contractId: c.id, entity: "invoice", entityId: inv.id, action: "duplicate_probe", actor: "user", summary: `Duplicate probe for ${inv.number} was NOT rejected — check Negative Testing toggle` });
    return { status: 201, issue: undefined, message: "PayPal accepted the duplicate — enable Negative Testing on the sandbox business account" };
  } catch (e) {
    if (!(e instanceof PayPalApiError)) throw e;
    await audit(db, {
      contractId: c.id,
      entity: "invoice",
      entityId: inv.id,
      action: "duplicate_probe",
      actor: "user",
      summary: `Duplicate guardrail verified: PayPal rejected a second ${inv.number} with ${e.status} ${e.issue}`,
    });
    return { status: e.status, issue: e.issue, message: e.message };
  }
}

export async function probeOverCap(userId: string, contractId: string): Promise<{ blocked: boolean; message: string }> {
  const c = await getContract(userId, contractId);
  const hist = await billingHistory(c.id);
  const amount = (c.totalCapCents ?? 0) - hist.invoicedCents + 100;
  try {
    assertWithinCap(c, hist.invoicedCents, amount);
    return { blocked: false, message: "Contract has no cap" };
  } catch (e) {
    await audit(getDb(), { contractId: c.id, entity: "contract", entityId: c.id, action: "cap_probe", actor: "user", summary: `Cap guardrail verified: ${(e as Error).message}` });
    return { blocked: true, message: (e as Error).message };
  }
}

export { minimumPaymentCents };
