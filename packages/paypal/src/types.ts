export interface Money {
  currency_code: string;
  value: string;
}

export interface InvoiceItem {
  name: string;
  description?: string;
  quantity: string;
  unit_amount: Money;
  unit_of_measure: "AMOUNT" | "HOURS" | "QUANTITY";
}

export interface InvoiceBody {
  detail: {
    invoice_number: string;
    currency_code: string;
    invoice_date?: string;
    reference?: string;
    note?: string;
    terms_and_conditions?: string;
    memo?: string;
    payment_term?: { term_type: string; due_date?: string };
  };
  invoicer?: { business_name?: string; email_address?: string; website?: string };
  primary_recipients: { billing_info: { email_address: string; name?: { full_name?: string } } }[];
  items: InvoiceItem[];
  configuration?: {
    allow_tip?: boolean;
    partial_payment?: { allow_partial_payment: boolean; minimum_amount_due?: Money };
  };
}

export interface PayPalInvoice {
  id: string;
  status: string;
  detail: InvoiceBody["detail"] & {
    metadata?: { recipient_view_url?: string; invoicer_view_url?: string; create_time?: string };
    payment_term?: { term_type: string; due_date?: string };
  };
  amount?: { currency_code: string; value: string };
  due_amount?: Money;
  payments?: { paid_amount?: Money; transactions?: unknown[] };
  links?: { href: string; rel: string; method?: string }[];
}

export interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string; field?: string }[];
}

export class PayPalApiError extends Error {
  constructor(
    public status: number,
    public body: PayPalErrorBody,
    public path: string,
  ) {
    super(`PayPal ${status} ${body.name ?? ""} ${body.details?.[0]?.issue ?? body.message ?? ""} (${path})`.trim());
  }
  get issue(): string | undefined {
    return this.body.details?.[0]?.issue ?? this.body.name;
  }
  get isDuplicateInvoiceNumber(): boolean {
    return this.status === 422 && this.body.details?.some((d) => d.issue === "DUPLICATE_INVOICE_ID") === true;
  }
}

export interface RequestOpts {
  requestId?: string;
  /** Sandbox negative testing, e.g. {"mock_application_codes":"DUPLICATE_INVOICE_ID"}. Sandbox only. */
  mockResponse?: string;
}

export interface WebhookHeaders {
  "paypal-auth-algo"?: string;
  "paypal-cert-url"?: string;
  "paypal-transmission-id"?: string;
  "paypal-transmission-sig"?: string;
  "paypal-transmission-time"?: string;
}

/** The subset of Invoicing v2 ProofBill uses. Implemented by the REST client and the offline simulator. */
export interface InvoicingApi {
  readonly mode: "sandbox" | "live" | "mock";
  createInvoice(body: InvoiceBody, opts?: RequestOpts): Promise<PayPalInvoice>;
  sendInvoice(id: string, args: { subject?: string; note?: string }, opts?: RequestOpts): Promise<{ href?: string }>;
  getInvoice(id: string): Promise<PayPalInvoice>;
  /** Recovery path for DUPLICATE_INVOICE_ID: find the invoice we already created under this number. */
  findInvoiceByNumber(number: string): Promise<PayPalInvoice | null>;
  listInvoices(args?: { page?: number; pageSize?: number }): Promise<PayPalInvoice[]>;
  remindInvoice(id: string, args: { subject: string; note: string }, opts?: RequestOpts): Promise<void>;
  cancelInvoice(id: string, args: { subject?: string; note?: string }, opts?: RequestOpts): Promise<void>;
  verifyWebhookSignature(headers: WebhookHeaders, rawBody: string, webhookId: string): Promise<boolean>;
}
