export function money(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function date(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function dateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

export const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  in_progress: "In progress",
  submitted: "Awaiting client",
  accepted: "Accepted",
  rejected: "Changes requested",
  invoiced: "Invoiced",
  paid: "Paid",
  draft: "Draft",
  sending: "Sending…",
  send_failed: "Send failed",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  MARKED_AS_PAID: "Paid",
  CANCELLED: "Cancelled",
  UNPAID: "Unpaid",
  PAYMENT_PENDING: "Payment pending",
  proposed: "Proposed",
  confirmed: "Confirmed",
  active: "Active",
};

export function tone(status: string): "neutral" | "info" | "warn" | "good" | "bad" | "accent" {
  switch (status) {
    case "accepted":
    case "paid":
    case "PAID":
    case "MARKED_AS_PAID":
    case "confirmed":
    case "active":
      return "good";
    case "submitted":
    case "PARTIALLY_PAID":
    case "sending":
    case "proposed":
      return "warn";
    case "rejected":
    case "send_failed":
    case "CANCELLED":
      return "bad";
    case "invoiced":
    case "SENT":
    case "UNPAID":
      return "info";
    case "in_progress":
      return "accent";
    default:
      return "neutral";
  }
}
