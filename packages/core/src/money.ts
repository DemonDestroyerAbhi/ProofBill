/** All money is integer cents. Never floats across a boundary. */
export type Cents = number;

export function toCents(amount: number): Cents {
  return Math.round(amount * 100);
}

export function centsToString(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatMoney(cents: Cents, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** Hours are stored as hundredths (12.5h = 1250) to keep arithmetic exact. */
export type HoursX100 = number;

export function toHoursX100(hours: number): HoursX100 {
  return Math.round(hours * 100);
}

export function hoursToString(h: HoursX100): string {
  return (h / 100).toFixed(2).replace(/\.?0+$/, "") || "0";
}

/** rate (cents/hour) × hours → cents, rounded half-up. */
export function hourlyAmount(rateCents: Cents, hours: HoursX100): Cents {
  return Math.round((rateCents * hours) / 100);
}
