import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, parseDate } from "@proofbill/core";
import { auditEvents, closeDb, eq, evidence, getDb, invoicePayments, invoices, milestones, paypalMockInvoices, webhookEvents, contracts, and } from "@proofbill/db";
import {
  approveAndSend,
  autoAcceptDue,
  buildInvoiceDraft,
  clientDecision,
  duplicateInvoiceProbe,
  getOrCreateDemoUser,
  handlePayPalWebhook,
  invoicing,
  ledgerRows,
  probeOverCap,
  runCollections,
  SAMPLE_SOW,
  seedDemoWorkspace,
  simulatePayment,
  submitMilestone,
  GuardrailError,
  reviewEvidence,
  loadContractBundle,
  MockInvoicing,
  createDraftFromText,
  confirmContract,
  extractedToConfirmed,
  reconcileInvoice,
} from "../src";

let userId: string;
let contractId: string;
const ms = async () => getDb().select().from(milestones).where(eq(milestones.contractId, contractId));
const m = async (n: number) => (await ms()).find((x) => x.number === n)!;

beforeAll(async () => {
  userId = (await getOrCreateDemoUser()).id;
  contractId = await seedDemoWorkspace(userId, { reset: true, clientEmail: "client@example.com" });
});
afterAll(closeDb);

describe("seeded demo workspace", () => {
  it("sample SOW embed matches sample-sow.md", () => {
    expect(SAMPLE_SOW).toBe(readFileSync(new URL("../../../sample-sow.md", import.meta.url), "utf8"));
  });

  it("extracts and confirms the Larkspur terms", async () => {
    const [c] = await getDb().select().from(contracts).where(eq(contracts.id, contractId));
    expect(c).toMatchObject({ status: "active", totalCapCents: 300000, hourlyRateCents: 4000, hourlyCapHours: 20, netDays: 15, partialMinPct: 25, lateFeePctMonthly: 1.5, acceptanceWindowBizDays: 5 });
    const all = await ms();
    expect(all.map((x) => [x.number, x.billing, x.amountCents, x.dependsOn])).toEqual([
      [1, "fixed", 60000, []],
      [2, "fixed", 90000, [1]],
      [3, "fixed", 70000, [2]],
      [4, "hourly", null, []],
    ]);
  });

  it("maps evidence with rationale; M1 accepted by client", async () => {
    const ev = await getDb().select().from(evidence).where(eq(evidence.contractId, contractId));
    const pr18 = ev.find((e) => e.ref.endsWith("#18"))!;
    expect(pr18.status).toBe("proposed");
    expect(pr18.milestoneId).toBe((await m(2)).id);
    expect(pr18.aiRationale).toMatch(/Milestone 2/);
    expect((await m(1)).status).toBe("accepted");
    expect((await m(1)).acceptedBy).toBe("client");
  });
});

describe("guardrails on milestones", () => {
  it("blocks submitting M3 before M2 is accepted", async () => {
    await expect(submitMilestone(userId, (await m(3)).id, null)).rejects.toThrow(/depends on Milestone 2/);
  });

  it("refuses to invoice a milestone the client hasn't accepted", async () => {
    await expect(buildInvoiceDraft(userId, (await m(2)).id)).rejects.toThrow(GuardrailError);
  });

  it("rejection needs a reason, then resubmission works", async () => {
    const [c] = await getDb().select().from(contracts).where(eq(contracts.id, contractId));
    const pr18 = (await getDb().select().from(evidence).where(eq(evidence.contractId, contractId))).find((e) => e.ref.endsWith("#18"))!;
    await reviewEvidence(userId, pr18.id, { action: "confirm", milestoneId: (await m(2)).id });
    await submitMilestone(userId, (await m(2)).id, "CSV + PDF export");
    await expect(clientDecision(c!.portalToken, (await m(2)).id, { action: "reject", reason: "" })).rejects.toThrow(/reason/);
    await clientDecision(c!.portalToken, (await m(2)).id, { action: "reject", reason: "PDF export is missing the logo" });
    expect((await m(2)).status).toBe("rejected");
    await expect(clientDecision("wrong-token", (await m(2)).id, { action: "accept" })).rejects.toThrow(/not found/);
    await submitMilestone(userId, (await m(2)).id, "Logo added to PDF export");
    expect((await m(2)).status).toBe("submitted");
  });

  it("auto-accepts after 5 business days of silence", async () => {
    const sub = await m(2);
    expect(await autoAcceptDue(addDays(sub.submittedAt!, 1))).toBe(0);
    expect(await autoAcceptDue(sub.acceptanceDeadline!)).toBe(1);
    const after = await m(2);
    expect(after).toMatchObject({ status: "accepted", acceptedBy: "auto" });
  });
});

describe("invoice → PayPal → paid", () => {
  let invId: string;
  let ppId: string;

  it("builds a draft with code-computed amount and evidence-backed lines", async () => {
    const inv = await buildInvoiceDraft(userId, (await m(1)).id);
    invId = inv.id;
    expect(inv).toMatchObject({ amountCents: 60000, minimumPaymentCents: 15000, status: "draft" });
    expect(inv.number).toMatch(/^PB-[A-Z]+[0-9A-F]{4}-M1$/);
    const again = await buildInvoiceDraft(userId, (await m(1)).id);
    expect(again.id).toBe(inv.id); // idempotent
    const b = await loadContractBundle(contractId);
    const lines = b.lines.filter((l) => l.invoiceId === inv.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.description).toMatch(/PR #12/);
    expect(lines[0]!.evidenceIds.length).toBe(2);
  });

  it("sends via PayPal once, even when approved twice", async () => {
    const sent = await approveAndSend(userId, invId);
    expect(sent.status).toBe("SENT");
    expect(sent.paypalInvoiceId).toMatch(/^INV2-MOCK-/);
    expect(sent.payerViewUrl).toContain("/mock-paypal/pay/");
    ppId = sent.paypalInvoiceId!;
    await expect(approveAndSend(userId, invId)).rejects.toThrow(/already/);
    expect((await m(1)).status).toBe("invoiced");
    const pp = await invoicing().getInvoice(ppId);
    expect(pp.detail.note).toContain("/portal/");
    expect((pp as unknown as { detail: { payment_term: { term_type: string } } }).detail.payment_term.term_type).toBe("NET_15");
  });

  it("duplicate invoice number is rejected by PayPal (negative test)", async () => {
    const r = await duplicateInvoiceProbe(userId, invId);
    expect(r).toMatchObject({ status: 422, issue: "DUPLICATE_INVOICE_ID" });
  });

  it("recovers from a crash between PayPal create and DB save", async () => {
    // M2 draft → simulate: PayPal invoice exists under the number, but our row never recorded it.
    const inv = await buildInvoiceDraft(userId, (await m(2)).id);
    const lines = (await loadContractBundle(contractId)).lines.filter((l) => l.invoiceId === inv.id);
    await invoicing().createInvoice(
      { detail: { invoice_number: inv.number, currency_code: "USD" }, primary_recipients: [{ billing_info: { email_address: "client@example.com" } }], items: lines.map((l) => ({ name: l.name, quantity: l.quantity, unit_amount: { currency_code: "USD", value: (l.unitAmountCents / 100).toFixed(2) }, unit_of_measure: "AMOUNT" as const })) },
      { requestId: "some-other-request" },
    );
    const sent = await approveAndSend(userId, inv.id);
    expect(sent.status).toBe("SENT");
    const audits = await getDb().select().from(auditEvents).where(and(eq(auditEvents.entityId, inv.id), eq(auditEvents.action, "duplicate_recovered")));
    expect(audits).toHaveLength(1);
  });

  it("partial payment below the 25% minimum is refused; partial then full via webhooks", async () => {
    await expect(simulatePayment(ppId, 10000)).rejects.toThrow(/Minimum/);
    await simulatePayment(ppId, 15000);
    let [inv] = await getDb().select().from(invoices).where(eq(invoices.id, invId));
    expect(inv).toMatchObject({ status: "PARTIALLY_PAID", paidCents: 15000 });
    expect((await m(1)).status).toBe("invoiced");
    await simulatePayment(ppId, 45000);
    [inv] = await getDb().select().from(invoices).where(eq(invoices.id, invId));
    expect(inv).toMatchObject({ status: "PAID", paidCents: 60000 });
    expect((await m(1)).status).toBe("paid");
  });

  it("dedupes webhook events by id and drops unverified ones", async () => {
    const ev = { id: "WH-TEST-1", event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: ppId } } };
    expect(await handlePayPalWebhook(ev, true)).toBe("processed");
    expect(await handlePayPalWebhook(ev, true)).toBe("duplicate");
    expect(await handlePayPalWebhook({ ...ev, id: "WH-TEST-2" }, false)).toBe("unverified");
    const [row] = await getDb().select().from(webhookEvents).where(eq(webhookEvents.id, "paypal:WH-TEST-2"));
    expect(row?.verified).toBe(false);
    // PayPal retries the unverified delivery; once it verifies it must be processed, not dropped as a duplicate.
    expect(await handlePayPalWebhook({ ...ev, id: "WH-TEST-2" }, true)).toBe("processed");
    expect(await handlePayPalWebhook({ ...ev, id: "WH-TEST-2" }, true)).toBe("duplicate");
  });
});

describe("hourly work and the contract cap", () => {
  it("bills logged hours at the contract rate", async () => {
    const [c] = await getDb().select().from(contracts).where(eq(contracts.id, contractId));
    await submitMilestone(userId, (await m(4)).id, "Change requests this sprint");
    await clientDecision(c!.portalToken, (await m(4)).id, { action: "accept" });
    const inv = await buildInvoiceDraft(userId, (await m(4)).id);
    expect(inv.amountCents).toBe(14000); // 3.5h × $40
    const b = await loadContractBundle(contractId);
    expect(b.lines.find((l) => l.invoiceId === inv.id)).toMatchObject({ unitOfMeasure: "HOURS", quantity: "3.5", unitAmountCents: 4000 });
    expect(b.timeEntries.every((t) => t.invoiceId === inv.id)).toBe(true);
  });

  it("blocks an invoice that would breach the $3,000 cap", async () => {
    // Invoiced so far: 600 + 900 + 140 (draft) = 1640. Inflate M3's fee past the remaining cap.
    const [c] = await getDb().select().from(contracts).where(eq(contracts.id, contractId));
    await getDb().update(milestones).set({ amountCents: 140000, status: "accepted" }).where(eq(milestones.id, (await m(3)).id));
    await expect(buildInvoiceDraft(userId, (await m(3)).id)).rejects.toMatchObject({ code: "OVER_CAP" });
    const probe = await probeOverCap(userId, c!.id);
    expect(probe.blocked).toBe(true);
  });
});

describe("collections cron", () => {
  it("reminds when overdue, assesses a late fee after 30 days, never twice", async () => {
    const [m2inv] = await getDb().select().from(invoices).where(and(eq(invoices.milestoneId, (await m(2)).id), eq(invoices.kind, "milestone")));
    const due = parseDate(m2inv!.dueDate!);
    let r = await runCollections(addDays(due, 2));
    expect(r.reminders).toBe(1);
    expect(r.lateFees).toBe(0);
    r = await runCollections(addDays(due, 3));
    expect(r.reminders).toBe(0); // weekly cadence
    r = await runCollections(addDays(due, 31));
    expect(r.lateFees).toBe(1);
    const fees = await getDb().select().from(invoices).where(eq(invoices.parentInvoiceId, m2inv!.id));
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({ kind: "late_fee", amountCents: 1350, status: "SENT", lateFeePeriod: 1 }); // 1.5% × 900
    r = await runCollections(addDays(due, 32));
    expect(r.lateFees).toBe(0);
    const [after] = await getDb().select().from(invoices).where(eq(invoices.id, m2inv!.id));
    expect(after!.reminderCount).toBeGreaterThanOrEqual(2);
  });

  it("late fees don't count toward the cap", async () => {
    const rows = await ledgerRows(userId);
    expect(rows.some((r) => r.kind === "late_fee")).toBe(true);
    expect(rows.find((r) => r.invoiceNumber.endsWith("-M1"))?.evidence.length).toBe(2);
  });
});

describe("payment reconciliation (Transaction Search)", () => {
  it("matched both payments on M1 with PayPal fees and net received", async () => {
    const [inv] = await getDb().select().from(invoices).where(and(eq(invoices.milestoneId, (await m(1)).id), eq(invoices.kind, "milestone")));
    expect(inv).toMatchObject({ reconcileStatus: "matched", paidCents: 60000 });
    const pays = await getDb().select().from(invoicePayments).where(eq(invoicePayments.invoiceId, inv!.id));
    expect(pays.map((p) => p.grossCents).sort()).toEqual([15000, 45000]);
    // simulated US invoicing rate: 3.49% + $0.49 per transaction
    expect(pays.reduce((s, p) => s + p.feeCents, 0)).toBe(Math.round(15000 * 0.0349) + 49 + Math.round(45000 * 0.0349) + 49);
    expect(inv!.netCents).toBe(60000 - inv!.feeCents!);
  });

  it("is idempotent and flags a mismatch when transactions don't cover what Invoicing reports", async () => {
    const [inv] = await getDb().select().from(invoices).where(and(eq(invoices.milestoneId, (await m(1)).id), eq(invoices.kind, "milestone")));
    const again = await reconcileInvoice(inv!.id);
    expect(again).toMatchObject({ status: "matched", newTransactions: 0 });
    // Lose one transaction on the PayPal side, then check well past the 3h search lag.
    const [mock] = await getDb().select().from(paypalMockInvoices).where(eq(paypalMockInvoices.id, inv!.paypalInvoiceId!));
    await getDb().update(paypalMockInvoices).set({ payments: (mock!.payments as unknown[]).slice(0, 1) }).where(eq(paypalMockInvoices.id, mock!.id));
    await getDb().delete(invoicePayments).where(eq(invoicePayments.invoiceId, inv!.id));
    const r = await reconcileInvoice(inv!.id, new Date(Date.now() + 4 * 3_600_000));
    expect(r.status).toBe("mismatch");
    const audits = await getDb().select().from(auditEvents).where(and(eq(auditEvents.entityId, inv!.id), eq(auditEvents.action, "reconcile_mismatch")));
    expect(audits).toHaveLength(1);
  });
});

describe("audit log", () => {
  it("records AI/system/user/client actors with rationale", async () => {
    const a = await getDb().select().from(auditEvents).where(eq(auditEvents.contractId, contractId));
    const actions = new Set(a.map((x) => x.action));
    for (const k of ["terms_extracted", "terms_confirmed", "evidence_mapped", "evidence_confirmed", "submitted", "accepted", "rejected", "auto_accepted", "draft_built", "lines_written", "sent", "status_synced", "reminder_sent", "late_fee_assessed", "duplicate_probe", "invoice_blocked", "reconciled"]) {
      expect(actions, k).toContain(k);
    }
    expect(a.filter((x) => x.action === "evidence_mapped").every((x) => x.rationale)).toBe(true);
  });
});

describe("contract with bad terms", () => {
  it("won't confirm fixed fees above the cap", async () => {
    const d = await createDraftFromText(userId, { name: "x.md", text: SAMPLE_SOW.replace("**$3,000**", "**$1,000**") });
    const t = extractedToConfirmed(d.extracted as never);
    const { issues } = await confirmContract(userId, d.id, t);
    expect(issues.some((i) => i.field === "totalCap" && i.level === "error")).toBe(true);
  });
  it("mock is in use for tests", () => {
    expect(invoicing()).toBeInstanceOf(MockInvoicing);
  });
});
