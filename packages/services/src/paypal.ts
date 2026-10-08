import { randomBytes } from "node:crypto";
import { centsToString } from "@proofbill/core";
import { eq, getDb, paypalMockInvoices } from "@proofbill/db";
import {
  moneyToCents,
  PayPalApiError,
  PayPalRestClient,
  TransactionSearchLookup,
  type InvoicePayment,
  type PaymentLookup,
  type PaymentLookupArgs,
  type InvoiceBody,
  type InvoicingApi,
  type PayPalInvoice,
  type RequestOpts,
} from "@proofbill/paypal";
import { appUrl, paypalMode } from "./env";

let cached: InvoicingApi | null = null;

export function invoicing(): InvoicingApi {
  if (cached && cached.mode === paypalMode()) return cached;
  const mode = paypalMode();
  cached =
    mode === "mock"
      ? new MockInvoicing()
      : new PayPalRestClient({ clientId: process.env.PAYPAL_CLIENT_ID!, clientSecret: process.env.PAYPAL_CLIENT_SECRET!, env: mode });
  return cached;
}

let cachedLookup: PaymentLookup | null = null;

/** Transaction Search (PayPal Server SDK) in sandbox/live; the simulator's recorded payments in mock mode. */
export function paymentLookup(): PaymentLookup {
  const mode = paypalMode();
  if (cachedLookup && cachedLookup.mode === mode) return cachedLookup;
  cachedLookup =
    mode === "mock"
      ? (invoicing() as MockInvoicing)
      : new TransactionSearchLookup({ clientId: process.env.PAYPAL_CLIENT_ID!, clientSecret: process.env.PAYPAL_CLIENT_SECRET!, env: mode });
  return cachedLookup;
}

/** For tests. */
export function setInvoicing(api: InvoicingApi | null): void {
  cached = api;
  cachedLookup = null;
}

function totalCents(body: InvoiceBody): number {
  return body.items.reduce((s, i) => s + Math.round(Number(i.quantity) * moneyToCents(i.unit_amount)), 0);
}

const dupErr = (path: string) =>
  new PayPalApiError(
    422,
    { name: "UNPROCESSABLE_ENTITY", message: "The requested action could not be performed.", details: [{ issue: "DUPLICATE_INVOICE_ID", description: "Invoice number is already used." }] },
    path,
  );

/**
 * Offline stand-in for Invoicing v2 with the same semantics ProofBill depends on:
 * PayPal-Request-Id replay, DUPLICATE_INVOICE_ID on reused numbers and on the negative-test header,
 * SENT → PARTIALLY_PAID → PAID. State lives in Postgres so web + worker share it.
 */
/** PayPal's standard US invoicing rate, used only to simulate fees offline. */
function simulatedFeeCents(gross: number): number {
  return Math.round(gross * 0.0349) + 49;
}

export class MockInvoicing implements InvoicingApi, PaymentLookup {
  readonly mode = "mock" as const;

  private async row(id: string) {
    const [r] = await getDb().select().from(paypalMockInvoices).where(eq(paypalMockInvoices.id, id));
    if (!r) throw new PayPalApiError(404, { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] }, `/v2/invoicing/invoices/${id}`);
    return r;
  }

  private present(r: typeof paypalMockInvoices.$inferSelect): PayPalInvoice {
    const body = r.body as InvoiceBody;
    const cur = body.detail.currency_code;
    const due = new Date(r.createdAt.getTime() + netDays(body.detail.payment_term?.term_type) * 86_400_000);
    return {
      id: r.id,
      status: r.status,
      detail: {
        ...body.detail,
        payment_term: { term_type: body.detail.payment_term?.term_type ?? "NET_30", due_date: due.toISOString().slice(0, 10) },
        metadata: { recipient_view_url: `${appUrl()}/mock-paypal/pay/${r.id}`, create_time: r.createdAt.toISOString() },
      },
      amount: { currency_code: cur, value: centsToString(r.totalCents) },
      due_amount: { currency_code: cur, value: centsToString(Math.max(0, r.totalCents - r.paidCents)) },
      payments: { paid_amount: { currency_code: cur, value: centsToString(r.paidCents) } },
    };
  }

  async createInvoice(body: InvoiceBody, opts: RequestOpts = {}): Promise<PayPalInvoice> {
    const db = getDb();
    if (opts.mockResponse?.includes("DUPLICATE_INVOICE_ID")) throw dupErr("/v2/invoicing/invoices");
    if (opts.requestId) {
      const [prior] = await db.select().from(paypalMockInvoices).where(eq(paypalMockInvoices.requestId, opts.requestId));
      if (prior) return this.present(prior); // idempotent replay
    }
    const [byNumber] = await db.select().from(paypalMockInvoices).where(eq(paypalMockInvoices.number, body.detail.invoice_number));
    if (byNumber) throw dupErr("/v2/invoicing/invoices");
    const id = `INV2-MOCK-${randomBytes(6).toString("hex").toUpperCase()}`;
    const [r] = await db
      .insert(paypalMockInvoices)
      .values({ id, requestId: opts.requestId ?? null, number: body.detail.invoice_number, body, totalCents: totalCents(body) })
      .returning();
    return this.present(r!);
  }

  async sendInvoice(id: string): Promise<{ href?: string }> {
    const r = await this.row(id);
    if (r.status === "DRAFT") await getDb().update(paypalMockInvoices).set({ status: "SENT" }).where(eq(paypalMockInvoices.id, id));
    return { href: `${appUrl()}/mock-paypal/pay/${id}` };
  }

  async getInvoice(id: string): Promise<PayPalInvoice> {
    return this.present(await this.row(id));
  }

  async findInvoiceByNumber(number: string): Promise<PayPalInvoice | null> {
    const [r] = await getDb().select().from(paypalMockInvoices).where(eq(paypalMockInvoices.number, number));
    return r ? this.present(r) : null;
  }

  async listInvoices(): Promise<PayPalInvoice[]> {
    const rows = await getDb().select().from(paypalMockInvoices);
    return rows.map((r) => this.present(r));
  }

  async remindInvoice(id: string): Promise<void> {
    const r = await this.row(id);
    if (!["SENT", "PARTIALLY_PAID", "UNPAID"].includes(r.status))
      throw new PayPalApiError(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "CANNOT_REMIND_INVOICE" }] }, `/remind`);
  }

  async cancelInvoice(id: string): Promise<void> {
    const r = await this.row(id);
    if (r.paidCents > 0)
      throw new PayPalApiError(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "CANT_CANCEL_PAID_INVOICE" }] }, `/cancel`);
    await getDb().update(paypalMockInvoices).set({ status: "CANCELLED" }).where(eq(paypalMockInvoices.id, id));
  }

  async findInvoicePayments(args: PaymentLookupArgs): Promise<InvoicePayment[]> {
    const [r] = await getDb().select().from(paypalMockInvoices).where(eq(paypalMockInvoices.id, args.paypalInvoiceId));
    return ((r?.payments ?? []) as InvoicePayment[]).filter((p) => {
      const t = p.initiatedAt ? Date.parse(p.initiatedAt) : 0;
      return t >= args.since.getTime() && t <= args.until.getTime();
    });
  }

  async verifyWebhookSignature(): Promise<boolean> {
    return false; // mock events never arrive over HTTP; they're applied in-process by simulatePayment()
  }

  /** The simulator's "payer pays" action. Enforces the invoice's partial-payment minimum like PayPal does. */
  async pay(id: string, cents: number): Promise<{ status: string; paidCents: number; totalCents: number }> {
    const r = await this.row(id);
    if (!["SENT", "PARTIALLY_PAID", "UNPAID"].includes(r.status)) throw new Error(`Invoice is ${r.status}`);
    const body = r.body as InvoiceBody;
    const due = r.totalCents - r.paidCents;
    const pp = body.configuration?.partial_payment;
    if (cents <= 0 || cents > due) throw new Error("Invalid amount");
    if (cents < due) {
      if (!pp?.allow_partial_payment) throw new Error("This invoice must be paid in full");
      const min = moneyToCents(pp.minimum_amount_due);
      if (r.paidCents === 0 && cents < min) throw new Error(`Minimum payment is ${centsToString(min)}`);
    }
    const paidCents = r.paidCents + cents;
    const status = paidCents >= r.totalCents ? "PAID" : "PARTIALLY_PAID";
    const fee = simulatedFeeCents(cents);
    const txn: InvoicePayment = {
      transactionId: `MOCK${randomBytes(7).toString("hex").toUpperCase()}`.slice(0, 17),
      status: "S",
      eventCode: "T0007",
      initiatedAt: new Date().toISOString(),
      grossCents: cents,
      feeCents: fee,
      netCents: cents - fee,
      currency: body.detail.currency_code,
    };
    await getDb()
      .update(paypalMockInvoices)
      .set({ paidCents, status, payments: [...(r.payments as InvoicePayment[]), txn] })
      .where(eq(paypalMockInvoices.id, id));
    return { status, paidCents, totalCents: r.totalCents };
  }
}

function netDays(term: string | undefined): number {
  const m = term?.match(/NET_(\d+)/);
  return m ? Number(m[1]) : 0;
}
