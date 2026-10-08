import {
  PayPalApiError,
  type InvoiceBody,
  type InvoicingApi,
  type PayPalErrorBody,
  type PayPalInvoice,
  type RequestOpts,
  type WebhookHeaders,
} from "./types";

export interface RestClientConfig {
  clientId: string;
  clientSecret: string;
  env: "sandbox" | "live";
  fetch?: typeof fetch;
  maxRetries?: number;
  /** Override for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const BASE = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Invoicing v2 over REST — the dependable core. Token cache, PayPal-Request-Id on every write,
 * bounded retries with backoff on transient failures (safe because writes carry a request id).
 */
export class PayPalRestClient implements InvoicingApi {
  readonly mode: "sandbox" | "live";
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private cfg: RestClientConfig) {
    this.mode = cfg.env;
    this.base = BASE[cfg.env];
    this.f = cfg.fetch ?? fetch;
    this.maxRetries = cfg.maxRetries ?? 3;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (!this.tokenPromise) {
      this.tokenPromise = (async () => {
        const auth = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
        const res = await this.f(`${this.base}/v1/oauth2/token`, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=client_credentials",
        });
        if (!res.ok) throw new PayPalApiError(res.status, await safeJson(res), "/v1/oauth2/token");
        const j = (await res.json()) as { access_token: string; expires_in: number };
        this.token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
        return j.access_token;
      })().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  async request<T>(method: string, path: string, body?: unknown, opts: RequestOpts & { prefer?: boolean } = {}): Promise<T> {
    let attempt = 0;
    for (;;) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
      };
      if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
      if (opts.prefer) headers.Prefer = "return=representation";
      if (opts.mockResponse && this.mode === "sandbox") headers["PayPal-Mock-Response"] = opts.mockResponse;

      let res: Response;
      try {
        res = await this.f(`${this.base}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        if (attempt++ < this.maxRetries && (method === "GET" || opts.requestId)) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw err;
      }

      if (res.status === 401 && attempt === 0) {
        this.token = null; // token revoked/expired early — refresh once
        attempt++;
        continue;
      }
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries && (method === "GET" || opts.requestId)) {
        attempt++;
        const ra = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt));
        continue;
      }
      if (!res.ok) throw new PayPalApiError(res.status, await safeJson(res), path);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  async createInvoice(body: InvoiceBody, opts: RequestOpts = {}): Promise<PayPalInvoice> {
    const res = await this.request<PayPalInvoice & { href?: string }>("POST", "/v2/invoicing/invoices", body, {
      ...opts,
      prefer: true,
    });
    // Without return=representation PayPal answers with just a link; normalise.
    if (!res.id && res.href) return this.getInvoice(res.href.split("/").pop()!);
    return res;
  }

  async sendInvoice(id: string, args: { subject?: string; note?: string }, opts: RequestOpts = {}): Promise<{ href?: string }> {
    const res = await this.request<{ href?: string; links?: { href: string; rel: string }[] } | undefined>(
      "POST",
      `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`,
      { send_to_invoicer: true, send_to_recipient: true, subject: args.subject, note: args.note },
      opts,
    );
    const href = res?.href ?? res?.links?.find((l) => l.rel === "payer-view")?.href;
    return { href };
  }

  getInvoice(id: string): Promise<PayPalInvoice> {
    return this.request("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
  }

  async findInvoiceByNumber(number: string): Promise<PayPalInvoice | null> {
    const res = await this.request<{ items?: PayPalInvoice[] }>(
      "POST",
      "/v2/invoicing/search-invoices?page=1&page_size=5&total_required=false",
      { invoice_number: number },
      { requestId: `pb-search-${number}-${Date.now()}` },
    );
    return res.items?.find((i) => i.detail?.invoice_number === number) ?? null;
  }

  async listInvoices(args: { page?: number; pageSize?: number } = {}): Promise<PayPalInvoice[]> {
    const q = new URLSearchParams({ page: String(args.page ?? 1), page_size: String(args.pageSize ?? 20), total_required: "false" });
    const res = await this.request<{ items?: PayPalInvoice[] }>("GET", `/v2/invoicing/invoices?${q}`);
    return res.items ?? [];
  }

  async remindInvoice(id: string, args: { subject: string; note: string }, opts: RequestOpts = {}): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
      subject: args.subject,
      note: args.note,
      send_to_invoicer: false,
      send_to_recipient: true,
    }, opts);
  }

  async cancelInvoice(id: string, args: { subject?: string; note?: string }, opts: RequestOpts = {}): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
      subject: args.subject,
      note: args.note,
      send_to_invoicer: true,
      send_to_recipient: true,
    }, opts);
  }

  async generateNextInvoiceNumber(): Promise<string> {
    const r = await this.request<{ invoice_number: string }>("POST", "/v2/invoicing/generate-next-invoice-number", undefined, {
      requestId: `pb-nextnum-${Date.now()}`,
    });
    return r.invoice_number;
  }

  async verifyWebhookSignature(h: WebhookHeaders, rawBody: string, webhookId: string): Promise<boolean> {
    if (!h["paypal-transmission-id"] || !h["paypal-transmission-sig"] || !h["paypal-cert-url"]) return false;
    const res = await this.request<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h["paypal-auth-algo"],
      cert_url: h["paypal-cert-url"],
      transmission_id: h["paypal-transmission-id"],
      transmission_sig: h["paypal-transmission-sig"],
      transmission_time: h["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    });
    return res.verification_status === "SUCCESS";
  }
}

function backoff(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
}

async function safeJson(res: Response): Promise<PayPalErrorBody> {
  try {
    return (await res.json()) as PayPalErrorBody;
  } catch {
    return { message: res.statusText };
  }
}
