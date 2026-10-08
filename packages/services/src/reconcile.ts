import { centsToString } from "@proofbill/core";
import { and, eq, getDb, inArray, invoicePayments, invoices, sql, type Invoice } from "@proofbill/db";
import { summarisePayments, TransactionSearchError } from "@proofbill/paypal";
import { audit } from "./audit";
import { paymentLookup } from "./paypal";

/** Transaction Search can take up to 3 hours to show a new payment. */
const SEARCH_LAG_MS = 3 * 3_600_000;

export interface ReconcileResult {
  status: "matched" | "pending" | "mismatch" | "skipped";
  newTransactions: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
}

/**
 * Match an invoice's payments to PayPal transactions (Transaction Search via the PayPal Server SDK):
 * records each transaction with PayPal's fee and the net received, and flags gaps between what
 * Invoicing says was paid and what the ledger of transactions shows.
 */
export async function reconcileInvoice(invoiceId: string, now = new Date()): Promise<ReconcileResult> {
  const db = getDb();
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  const skip: ReconcileResult = { status: "skipped", newTransactions: 0, grossCents: 0, feeCents: 0, netCents: 0 };
  if (!inv?.paypalInvoiceId || inv.paidCents <= 0) return skip;

  const since = new Date((inv.sentAt ?? inv.createdAt).getTime() - 86_400_000);
  const found = await paymentLookup().findInvoicePayments({
    paypalInvoiceId: inv.paypalInvoiceId,
    invoiceNumber: inv.number,
    since,
    until: now,
  });

  let added = 0;
  for (const p of found) {
    const [row] = await db
      .insert(invoicePayments)
      .values({
        invoiceId: inv.id,
        transactionId: p.transactionId,
        status: p.status,
        eventCode: p.eventCode,
        initiatedAt: p.initiatedAt ? new Date(p.initiatedAt) : null,
        grossCents: p.grossCents,
        feeCents: p.feeCents,
        netCents: p.netCents,
        currency: p.currency,
      })
      .onConflictDoUpdate({
        target: [invoicePayments.invoiceId, invoicePayments.transactionId],
        set: { status: p.status, feeCents: p.feeCents, netCents: p.netCents, grossCents: p.grossCents },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (row?.inserted) added++;
  }

  const all = await db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, inv.id));
  const sum = summarisePayments(all.map((p) => ({ ...p, initiatedAt: p.initiatedAt?.toISOString() ?? null })));
  const recentlyPaid = inv.updatedAt.getTime() > now.getTime() - SEARCH_LAG_MS;
  const status: ReconcileResult["status"] =
    sum.grossCents === inv.paidCents ? "matched" : sum.grossCents < inv.paidCents && recentlyPaid ? "pending" : "mismatch";

  await db
    .update(invoices)
    .set({ feeCents: sum.feeCents, netCents: sum.netCents, reconcileStatus: status, reconciledAt: now })
    .where(eq(invoices.id, inv.id));

  if (added > 0 || (status === "mismatch" && inv.reconcileStatus !== "mismatch")) {
    await audit(db, {
      contractId: inv.contractId,
      entity: "invoice",
      entityId: inv.id,
      action: status === "mismatch" ? "reconcile_mismatch" : "reconciled",
      actor: "system",
      summary:
        status === "mismatch"
          ? `${inv.number}: PayPal Invoicing reports ${centsToString(inv.paidCents)} paid but Transaction Search shows ${centsToString(sum.grossCents)} in completed transactions`
          : `${inv.number}: ${added} new PayPal transaction${added === 1 ? "" : "s"} matched (${sum.completed} in total) — received so far: gross ${centsToString(sum.grossCents)}, PayPal fees ${centsToString(sum.feeCents)}, net ${centsToString(sum.netCents)} ${inv.currency}`,
      rationale: "Matched by PayPal invoice id (cart_info) or invoice number via Transaction Search.",
      source: { transactions: found.map((p) => p.transactionId), mode: paymentLookup().mode },
    });
  }
  return { status, newTransactions: added, ...sum };
}

/** Best-effort wrapper for hot paths (webhooks): never let reconciliation break payment processing. */
export async function tryReconcile(invoiceId: string): Promise<ReconcileResult | null> {
  try {
    return await reconcileInvoice(invoiceId);
  } catch (e) {
    const [inv] = await getDb().select().from(invoices).where(eq(invoices.id, invoiceId));
    if (inv)
      await audit(getDb(), {
        contractId: inv.contractId,
        entity: "invoice",
        entityId: inv.id,
        action: "reconcile_failed",
        actor: "system",
        summary: `Transaction Search lookup failed for ${inv.number}: ${(e as Error).message}`,
        rationale: e instanceof TransactionSearchError && e.status === 403 ? "Enable 'Transaction search' on the PayPal REST app." : null,
      });
    return null;
  }
}

/** Cron: reconcile every invoice with money received that isn't fully matched yet. */
export async function reconcileOutstanding(now = new Date()): Promise<{ checked: number; matched: number; errors: string[] }> {
  const db = getDb();
  const rows: Invoice[] = await db
    .select()
    .from(invoices)
    .where(
      and(
        inArray(invoices.status, ["PARTIALLY_PAID", "PAID"]),
        sql`${invoices.paypalInvoiceId} IS NOT NULL`,
        sql`(${invoices.reconcileStatus} IS NULL OR ${invoices.reconcileStatus} <> 'matched')`,
      ),
    );
  const out = { checked: 0, matched: 0, errors: [] as string[] };
  for (const inv of rows) {
    out.checked++;
    try {
      if ((await reconcileInvoice(inv.id, now)).status === "matched") out.matched++;
    } catch (e) {
      out.errors.push(`${inv.number}: ${(e as Error).message}`);
    }
  }
  return out;
}
