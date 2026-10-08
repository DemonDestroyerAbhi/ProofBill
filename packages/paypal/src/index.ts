export * from "./types";
export * from "./rest";
export * from "./build";

export const DUPLICATE_INVOICE_MOCK = JSON.stringify({ mock_application_codes: "DUPLICATE_INVOICE_ID" });

export const INVOICE_WEBHOOK_EVENTS = [
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.REFUNDED",
] as const;
