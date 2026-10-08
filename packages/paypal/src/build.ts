import type { InvoiceBody } from "./types";

export interface BuildInvoiceArgs {
  number: string;
  currency: string;
  invoiceDate: string; // YYYY-MM-DD
  termType: string; // NET_15 …
  recipientEmail: string;
  recipientName?: string;
  reference?: string;
  note?: string;
  terms?: string;
  memo?: string;
  items: {
    name: string;
    description: string;
    quantity: string;
    unitAmount: string;
    unitOfMeasure: "AMOUNT" | "HOURS";
  }[];
  minimumAmountDue?: string | null;
}

/** Maps ProofBill's computed invoice to the Invoicing v2 payload. Pure — no pricing decisions here. */
export function buildInvoiceBody(a: BuildInvoiceArgs): InvoiceBody {
  return {
    detail: {
      invoice_number: a.number,
      currency_code: a.currency,
      invoice_date: a.invoiceDate,
      reference: a.reference?.slice(0, 120),
      note: a.note?.slice(0, 4000),
      terms_and_conditions: a.terms?.slice(0, 4000),
      memo: a.memo?.slice(0, 500),
      payment_term: { term_type: a.termType },
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: a.recipientEmail,
          ...(a.recipientName ? { name: { full_name: a.recipientName } } : {}),
        },
      },
    ],
    items: a.items.map((i) => ({
      name: i.name.slice(0, 200),
      description: i.description.slice(0, 1000),
      quantity: i.quantity,
      unit_amount: { currency_code: a.currency, value: i.unitAmount },
      unit_of_measure: i.unitOfMeasure,
    })),
    configuration: {
      allow_tip: false,
      partial_payment: a.minimumAmountDue
        ? { allow_partial_payment: true, minimum_amount_due: { currency_code: a.currency, value: a.minimumAmountDue } }
        : { allow_partial_payment: false },
    },
  };
}

/** Payer link: send response href → metadata.recipient_view_url fallback. */
export function payerLink(sendHref: string | undefined, inv: { detail?: { metadata?: { recipient_view_url?: string } } }): string | null {
  return sendHref ?? inv.detail?.metadata?.recipient_view_url ?? null;
}

export function moneyToCents(m: { value: string } | undefined | null): number {
  if (!m) return 0;
  const [whole, frac = ""] = m.value.split(".");
  const sign = whole!.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number(frac.padEnd(2, "0").slice(0, 2)));
}
