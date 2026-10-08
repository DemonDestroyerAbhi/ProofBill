export type PayPalMode = "sandbox" | "live" | "mock";

/**
 * PAYPAL_ENV=sandbox|live uses the real Invoicing v2 API (requires client id/secret).
 * PAYPAL_ENV=mock — or no credentials — uses the offline simulator so the whole flow runs locally/CI.
 */
export function paypalMode(): PayPalMode {
  const env = (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase();
  if (env === "mock") return "mock";
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return "mock";
  return env === "live" ? "live" : "sandbox";
}

export function appUrl(): string {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function portalUrl(token: string): string {
  return `${appUrl()}/portal/${token}`;
}

export function freelancerName(): string {
  return process.env.FREELANCER_NAME || "Your freelancer";
}
