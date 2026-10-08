import { NextResponse, type NextRequest } from "next/server";
import { handlePayPalWebhook, invoicing, type PayPalWebhookEvent } from "@proofbill/services";

/**
 * PayPal webhooks: INVOICING.INVOICE.PAID / UPDATED / CANCELLED.
 * Signature verified via POST /v1/notifications/verify-webhook-signature with PAYPAL_WEBHOOK_ID; deduped by event id.
 * Unverified events are stored (for debugging) but never applied.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!event?.id || !event.event_type) return NextResponse.json({ error: "not a PayPal event" }, { status: 400 });

  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  let verified = false;
  if (webhookId) {
    const h = (k: string) => req.headers.get(k) ?? undefined;
    try {
      verified = await invoicing().verifyWebhookSignature(
        {
          "paypal-auth-algo": h("paypal-auth-algo"),
          "paypal-cert-url": h("paypal-cert-url"),
          "paypal-transmission-id": h("paypal-transmission-id"),
          "paypal-transmission-sig": h("paypal-transmission-sig"),
          "paypal-transmission-time": h("paypal-transmission-time"),
        },
        raw,
        webhookId,
      );
    } catch (e) {
      console.error("paypal webhook verification error", e);
      return NextResponse.json({ error: "verification unavailable" }, { status: 503 }); // PayPal retries
    }
  }
  const result = await handlePayPalWebhook(event, verified);
  console.log(`paypal webhook ${event.event_type} ${event.id}: ${result}`);
  // 200 for duplicates/ignored so PayPal stops retrying; 401 for unverified.
  return NextResponse.json({ result }, { status: result === "unverified" ? 401 : 200 });
}
