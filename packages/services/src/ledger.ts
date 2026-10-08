import type { AssistantTool } from "@proofbill/ai";
import { daysBetween, parseDate } from "@proofbill/core";
import { clients, contracts, eq, evidence, getDb, inArray, invoiceLines, invoices, milestones, timeEntries } from "@proofbill/db";
import { invoicing } from "./paypal";

export interface LedgerRow {
  lineId: string;
  invoiceId: string;
  invoiceNumber: string;
  contractId: string;
  contractTitle: string;
  client: string;
  milestone: string;
  milestoneStatus: string;
  kind: string;
  line: string;
  unit: string;
  quantity: number;
  hours: number | null;
  amount: number;
  invoiceTotal: number;
  paid: number;
  balance: number;
  currency: string;
  status: string;
  sentAt: string | null;
  dueDate: string | null;
  daysOverdue: number;
  reminders: number;
  payerViewUrl: string | null;
  evidence: { id: string; title: string; url: string | null; type: string; confidence: number | null; rationale: string | null }[];
}

/** Receivables ledger: one row per invoice line; evidence nested for the master-detail view. */
export async function ledgerRows(userId: string, now = new Date()): Promise<LedgerRow[]> {
  const db = getDb();
  const cs = await db.select().from(contracts).where(eq(contracts.userId, userId));
  if (!cs.length) return [];
  const invs = await db.select().from(invoices).where(inArray(invoices.contractId, cs.map((c) => c.id)));
  if (!invs.length) return [];
  const [lines, ms, cl, ev] = await Promise.all([
    db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invs.map((i) => i.id))),
    db.select().from(milestones).where(inArray(milestones.contractId, cs.map((c) => c.id))),
    db.select().from(clients).where(eq(clients.userId, userId)),
    db.select().from(evidence).where(inArray(evidence.contractId, cs.map((c) => c.id))),
  ]);
  return lines.map((l) => {
    const inv = invs.find((i) => i.id === l.invoiceId)!;
    const c = cs.find((x) => x.id === inv.contractId)!;
    const m = ms.find((x) => x.id === inv.milestoneId);
    const overdue = inv.dueDate && !["PAID", "MARKED_AS_PAID", "CANCELLED", "draft"].includes(inv.status) ? Math.max(0, daysBetween(parseDate(inv.dueDate), now)) : 0;
    const lineEv = ev.filter((e) => (l.evidenceIds.length ? l.evidenceIds.includes(e.id) : e.milestoneId === inv.milestoneId && e.status === "confirmed"));
    return {
      lineId: l.id,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      contractId: c.id,
      contractTitle: c.title,
      client: cl.find((x) => x.id === c.clientId)?.name ?? "",
      milestone: m ? `M${m.number} ${m.title}` : "",
      milestoneStatus: m?.status ?? "",
      kind: inv.kind,
      line: l.name,
      unit: l.unitOfMeasure,
      quantity: Number(l.quantity),
      hours: l.unitOfMeasure === "HOURS" ? Number(l.quantity) : null,
      amount: l.totalCents / 100,
      invoiceTotal: inv.amountCents / 100,
      paid: inv.paidCents / 100,
      balance: (inv.amountCents - inv.paidCents) / 100,
      currency: inv.currency,
      status: inv.status,
      sentAt: inv.sentAt?.toISOString() ?? null,
      dueDate: inv.dueDate,
      daysOverdue: overdue,
      reminders: inv.reminderCount,
      payerViewUrl: inv.payerViewUrl,
      evidence: lineEv.map((e) => ({ id: e.id, title: e.title, url: e.url, type: e.type, confidence: e.aiConfidence, rationale: e.aiRationale })),
    };
  });
}

/** Read-only tools for the ledger assistant: our DB plus live PayPal Invoicing reads. */
export function assistantTools(userId: string): AssistantTool[] {
  return [
    {
      name: "list_receivables",
      description: "List invoices with client, milestone, amount, paid, balance, status, due date and days overdue. Optionally filter by client/contract name substring or status.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "Client or contract name substring" }, status: { type: "string" } },
      },
      run: async (input) => {
        const rows = await ledgerRows(userId);
        const q = String(input.query ?? "").toLowerCase();
        const byInv = new Map<string, LedgerRow>();
        for (const r of rows) if (!byInv.has(r.invoiceId)) byInv.set(r.invoiceId, r);
        return [...byInv.values()]
          .filter((r) => !q || r.client.toLowerCase().includes(q) || r.contractTitle.toLowerCase().includes(q))
          .filter((r) => !input.status || r.status === input.status)
          .map(({ invoiceNumber, client, contractTitle, milestone, invoiceTotal, paid, balance, currency, status, dueDate, daysOverdue, reminders }) => ({
            invoiceNumber, client, contractTitle, milestone, total: invoiceTotal, paid, balance, currency, status, dueDate, daysOverdue, reminders,
          }));
      },
    },
    {
      name: "list_milestones",
      description: "List contract milestones with status (planned/in_progress/submitted/accepted/rejected/invoiced/paid), fee, due date, acceptance deadline and confirmed evidence count.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "Client or contract name substring" } } },
      run: async (input) => {
        const db = getDb();
        const cs = await db.select().from(contracts).where(eq(contracts.userId, userId));
        const q = String(input.query ?? "").toLowerCase();
        const sel = cs.filter((c) => !q || c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
        if (!sel.length) return [];
        const [ms, ev] = await Promise.all([
          db.select().from(milestones).where(inArray(milestones.contractId, sel.map((c) => c.id))),
          db.select().from(evidence).where(inArray(evidence.contractId, sel.map((c) => c.id))),
        ]);
        const te = ms.length ? await db.select().from(timeEntries).where(inArray(timeEntries.milestoneId, ms.map((m) => m.id))) : [];
        return ms.map((m) => ({
          contract: sel.find((c) => c.id === m.contractId)?.title,
          number: m.number,
          title: m.title,
          status: m.status,
          fee: m.amountCents != null ? m.amountCents / 100 : null,
          billing: m.billing,
          hoursLogged: te.filter((t) => t.milestoneId === m.id).reduce((s, t) => s + t.hoursX100, 0) / 100,
          dueDate: m.dueDate,
          acceptanceDeadline: m.acceptanceDeadline,
          rejectionReason: m.rejectionReason,
          confirmedEvidence: ev.filter((e) => e.milestoneId === m.id && e.status === "confirmed").length,
        }));
      },
    },
    {
      name: "get_paypal_invoice",
      description: "Fetch the live PayPal Invoicing v2 record for one of our invoice numbers (e.g. PB-LARK1A-M1): status, amount, paid amount, due amount, due date.",
      input_schema: { type: "object", properties: { invoiceNumber: { type: "string" } }, required: ["invoiceNumber"] },
      run: async (input) => {
        const db = getDb();
        const [inv] = await db.select().from(invoices).where(eq(invoices.number, String(input.invoiceNumber)));
        if (!inv?.paypalInvoiceId) throw new Error("No PayPal invoice with that number");
        const [c] = await db.select().from(contracts).where(eq(contracts.id, inv.contractId));
        if (c?.userId !== userId) throw new Error("No PayPal invoice with that number");
        const pp = await invoicing().getInvoice(inv.paypalInvoiceId);
        return {
          paypalId: pp.id,
          status: pp.status,
          amount: pp.amount,
          paid: pp.payments?.paid_amount,
          due: pp.due_amount,
          dueDate: pp.detail.payment_term?.due_date,
          mode: invoicing().mode,
        };
      },
    },
  ];
}
