/**
 * Payment reconciliation via PayPal Transaction Search, using the APIMatic-generated PayPal Server SDK
 * (`@paypal/paypal-server-sdk`). Built with the APIMatic PayPal Context Plugin skills in .claude/skills.
 *
 * Invoicing v2 tells us an invoice is PAID; Transaction Search tells us which PayPal transactions paid
 * it, what PayPal charged in fees, and what actually landed in the freelancer's account.
 */
import { ApiError, Client, Environment, SearchError, TransactionSearchController } from "@paypal/paypal-server-sdk";
import type { Money, OAuthToken, TransactionDetails } from "@paypal/paypal-server-sdk";
import { moneyToCents } from "./build";

export interface InvoicePayment {
  transactionId: string;
  /** S = success, P = pending, V = reversed/refunded, D = denied. */
  status: string;
  eventCode: string | null;
  initiatedAt: string | null;
  grossCents: number;
  /** PayPal's fee as a positive number of cents. */
  feeCents: number;
  netCents: number;
  currency: string;
}

export interface PaymentLookupArgs {
  paypalInvoiceId: string;
  invoiceNumber: string;
  /** Search window. Transaction Search allows at most 31 days per request, so longer windows are split. */
  since: Date;
  until: Date;
}

export interface PaymentLookup {
  readonly mode: "sandbox" | "live" | "mock";
  findInvoicePayments(args: PaymentLookupArgs): Promise<InvoicePayment[]>;
}

export class TransactionSearchError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public issue: string | undefined,
  ) {
    super(message);
  }
}

const WINDOW_MS = 31 * 86_400_000 - 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** RFC 3339 with seconds, as Transaction Search requires. */
function rfc3339(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Splits [since, until] into ≤31-day windows. Exported for tests. */
export function searchWindows(since: Date, until: Date): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  for (let t = since.getTime(); t < until.getTime(); t += WINDOW_MS) {
    out.push({ start: new Date(t), end: new Date(Math.min(t + WINDOW_MS, until.getTime())) });
  }
  return out;
}

type SearchErrorPayload = NonNullable<SearchError["result"]>;

function parseSearchError(body: unknown): SearchErrorPayload | undefined {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body) as SearchErrorPayload;
  } catch {
    return undefined;
  }
}

const cents = (m: Money | undefined) => (m ? moneyToCents({ value: m.value }) : 0);

/** A transaction belongs to the invoice if PayPal's cart info names the invoice, or its invoice_id is our number. */
export function matchesInvoice(t: TransactionDetails, args: Pick<PaymentLookupArgs, "paypalInvoiceId" | "invoiceNumber">): boolean {
  return t.cartInfo?.paypalInvoiceId === args.paypalInvoiceId || t.transactionInfo?.invoiceId === args.invoiceNumber;
}

export function toInvoicePayment(t: TransactionDetails): InvoicePayment | null {
  const info = t.transactionInfo;
  if (!info?.transactionId || !info.transactionAmount) return null;
  const gross = cents(info.transactionAmount);
  const fee = Math.abs(cents(info.feeAmount));
  return {
    transactionId: info.transactionId,
    status: info.transactionStatus ?? "?",
    eventCode: info.transactionEventCode ?? null,
    initiatedAt: info.transactionInitiationDate ?? null,
    grossCents: gross,
    feeCents: fee,
    netCents: gross - fee,
    currency: info.transactionAmount.currencyCode,
  };
}

export interface ServerSdkConfig {
  clientId: string;
  clientSecret: string;
  env: "sandbox" | "live";
  /** Test seam (typescript-testing skill): stub axios adapter + seeded token. */
  unstableHttpClientOptions?: unknown;
  seedToken?: OAuthToken;
}

export function createServerSdkClient(cfg: ServerSdkConfig): Client {
  return new Client({
    environment: cfg.env === "live" ? Environment.Production : Environment.Sandbox,
    clientCredentialsAuthCredentials: {
      oAuthClientId: cfg.clientId,
      oAuthClientSecret: cfg.clientSecret,
      oAuthClockSkew: 60,
      ...(cfg.seedToken ? { oAuthToken: cfg.seedToken } : {}),
    },
    // The generated default timeout is 0 (= wait forever); set it explicitly.
    timeout: 30_000,
    httpClientOptions: {
      timeout: 30_000,
      // Generated defaults disable retries (maximumRetryWaitTime 0). Search is a GET, so retrying is safe.
      retryConfig: { maxNumberOfRetries: 3, maximumRetryWaitTime: 30, retryInterval: 1, backoffFactor: 2, httpMethodsToRetry: ["GET"] },
    },
    ...(cfg.unstableHttpClientOptions ? { unstable_httpClientOptions: cfg.unstableHttpClientOptions } : {}),
  });
}

export class TransactionSearchLookup implements PaymentLookup {
  readonly mode: "sandbox" | "live";
  private readonly api: TransactionSearchController;

  constructor(cfgOrClient: ServerSdkConfig | { client: Client; env: "sandbox" | "live" }) {
    const client = "client" in cfgOrClient ? cfgOrClient.client : createServerSdkClient(cfgOrClient);
    this.mode = cfgOrClient.env;
    // Controllers are constructed, not accessed off the client.
    this.api = new TransactionSearchController(client);
  }

  async findInvoicePayments(args: PaymentLookupArgs): Promise<InvoicePayment[]> {
    const found = new Map<string, InvoicePayment>();
    for (const w of searchWindows(args.since, args.until)) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        let res;
        try {
          res = await this.api.searchTransactions({
            startDate: rfc3339(w.start),
            endDate: rfc3339(w.end),
            fields: "transaction_info,cart_info",
            balanceAffectingRecordsOnly: "Y",
            pageSize: PAGE_SIZE,
            page,
          });
        } catch (err) {
          if (err instanceof SearchError) {
            // Payload keeps the wire's field names (snake_case). SearchError is registered via
            // defaultToError, which leaves `result` unparsed in SDK 2.5.0 — fall back to the raw body.
            const p = err.result ?? parseSearchError(err.body);
            throw new TransactionSearchError(
              `Transaction Search ${err.statusCode}: ${p?.name ?? ""} ${p?.message ?? ""}`.trim(),
              err.statusCode,
              p?.details?.[0]?.issue ?? p?.name,
            );
          }
          if (err instanceof ApiError) {
            throw new TransactionSearchError(`Transaction Search ${err.statusCode}: ${String(err.body).slice(0, 300)}`, err.statusCode, undefined);
          }
          throw err;
        }
        const rows = res.result.transactionDetails ?? [];
        for (const t of rows) {
          if (!matchesInvoice(t, args)) continue;
          const p = toInvoicePayment(t);
          if (p) found.set(p.transactionId, p);
        }
        const totalPages = res.result.totalPages ?? 1;
        if (page >= totalPages || rows.length < PAGE_SIZE) break;
      }
    }
    return [...found.values()].sort((a, b) => (a.initiatedAt ?? "").localeCompare(b.initiatedAt ?? ""));
  }
}

export function summarisePayments(ps: InvoicePayment[]): { grossCents: number; feeCents: number; netCents: number; completed: number } {
  const ok = ps.filter((p) => p.status === "S");
  return {
    grossCents: ok.reduce((s, p) => s + p.grossCents, 0),
    feeCents: ok.reduce((s, p) => s + p.feeCents, 0),
    netCents: ok.reduce((s, p) => s + p.netCents, 0),
    completed: ok.length,
  };
}
