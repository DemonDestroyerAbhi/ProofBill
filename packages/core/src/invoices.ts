/**
 * Invoice numbers are deterministic per (contract, milestone, sequence) so that a retry can never
 * mint a second number for the same work. DB uniqueness + PayPal's DUPLICATE_INVOICE_ID back this up.
 */
export function invoiceNumber(contractCode: string, milestoneNumber: number, seq = 1): string {
  return `PB-${contractCode}-M${milestoneNumber}${seq > 1 ? `-${seq}` : ""}`;
}

export function lateFeeInvoiceNumber(parentNumber: string, period: number): string {
  return `${parentNumber}-LF${period}`;
}

/** PayPal-Request-Id: stable per logical operation, so replays are idempotent server-side. */
export function paypalRequestId(op: "create" | "send" | "remind" | "cancel", invoiceId: string, suffix = ""): string {
  return `pb-${op}-${invoiceId}${suffix ? `-${suffix}` : ""}`;
}

export function netTermType(netDays: number): string {
  const supported = [10, 15, 30, 45, 60, 90];
  return supported.includes(netDays) ? `NET_${netDays}` : netDays === 0 ? "DUE_ON_RECEIPT" : "NET_30";
}

export const INVOICE_STATUSES = [
  "draft", // ours, not on PayPal yet
  "DRAFT",
  "SENT",
  "SCHEDULED",
  "PARTIALLY_PAID",
  "PAID",
  "MARKED_AS_PAID",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "MARKED_AS_REFUNDED",
  "UNPAID",
  "PAYMENT_PENDING",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function isPaidStatus(s: string): boolean {
  return s === "PAID" || s === "MARKED_AS_PAID";
}

export function isOpenStatus(s: string): boolean {
  return s === "SENT" || s === "PARTIALLY_PAID" || s === "UNPAID" || s === "PAYMENT_PENDING";
}

/** Counts towards the contract cap: anything not cancelled. */
export function countsTowardsCap(s: string): boolean {
  return s !== "CANCELLED";
}
