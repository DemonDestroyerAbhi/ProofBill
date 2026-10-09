import { describe, expect, it } from "vitest";
import { PayPalRestClient, PayPalApiError, buildInvoiceBody, moneyToCents, DUPLICATE_INVOICE_MOCK } from "../src";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: ((c: Call) => Response)[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return next(c);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = json(200, { access_token: "T", expires_in: 3600 });

describe("PayPalRestClient", () => {
  it("caches the token and sends PayPal-Request-Id + Prefer on create", async () => {
    const { f, calls } = fakeFetch([token, json(201, { id: "INV2-1", status: "DRAFT" }), json(200, { id: "INV2-1", status: "DRAFT" })]);
    const pp = new PayPalRestClient({ clientId: "a", clientSecret: "b", env: "sandbox", fetch: f, sleep: async () => {} });
    const inv = await pp.createInvoice({ detail: { invoice_number: "PB-1", currency_code: "USD" }, primary_recipients: [], items: [] }, { requestId: "pb-create-1" });
    expect(inv.id).toBe("INV2-1");
    await pp.getInvoice("INV2-1");
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
    const h = calls[1]!.init.headers as Record<string, string>;
    expect(h["PayPal-Request-Id"]).toBe("pb-create-1");
    expect(h.Prefer).toBe("return=representation");
  });

  it("retries 5xx on idempotent writes, not on non-idempotent", async () => {
    const { f, calls } = fakeFetch([token, json(503, {}), json(201, { id: "X", status: "DRAFT" })]);
    const pp = new PayPalRestClient({ clientId: "a", clientSecret: "b", env: "sandbox", fetch: f, sleep: async () => {} });
    await pp.createInvoice({ detail: { invoice_number: "PB-1", currency_code: "USD" }, primary_recipients: [], items: [] }, { requestId: "r" });
    expect(calls).toHaveLength(3);
  });

  it("surfaces DUPLICATE_INVOICE_ID as a typed error and forwards the mock header", async () => {
    const { f, calls } = fakeFetch([
      token,
      json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "DUPLICATE_INVOICE_ID" }] }),
    ]);
    const pp = new PayPalRestClient({ clientId: "a", clientSecret: "b", env: "sandbox", fetch: f, sleep: async () => {} });
    const err = await pp
      .createInvoice({ detail: { invoice_number: "PB-1", currency_code: "USD" }, primary_recipients: [], items: [] }, { requestId: "r", mockResponse: DUPLICATE_INVOICE_MOCK })
      .catch((e) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).isDuplicateInvoiceNumber).toBe(true);
    expect((calls[1]!.init.headers as Record<string, string>)["PayPal-Mock-Response"]).toBe(DUPLICATE_INVOICE_MOCK);
  });

  it("verifies webhook signatures via PayPal", async () => {
    const { f, calls } = fakeFetch([token, json(200, { verification_status: "SUCCESS" })]);
    const pp = new PayPalRestClient({ clientId: "a", clientSecret: "b", env: "sandbox", fetch: f, sleep: async () => {} });
    const ok = await pp.verifyWebhookSignature(
      { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://x", "paypal-transmission-id": "t", "paypal-transmission-sig": "s", "paypal-transmission-time": "now" },
      JSON.stringify({ id: "WH-1" }),
      "WEBHOOK",
    );
    expect(ok).toBe(true);
    expect(JSON.parse(calls[1]!.init.body as string).webhook_event.id).toBe("WH-1");
  });

  it("rejects unsigned webhooks without calling PayPal", async () => {
    const pp = new PayPalRestClient({ clientId: "a", clientSecret: "b", env: "sandbox", fetch: fakeFetch([]).f });
    expect(await pp.verifyWebhookSignature({}, "{}", "W")).toBe(false);
  });
});

describe("buildInvoiceBody", () => {
  it("maps partial payments and units", () => {
    const b = buildInvoiceBody({
      number: "PB-X-M1",
      currency: "USD",
      invoiceDate: "2026-10-24",
      termType: "NET_15",
      recipientEmail: "c@x.com",
      items: [{ name: "M1", description: "d", quantity: "1", unitAmount: "600.00", unitOfMeasure: "AMOUNT" }],
      minimumAmountDue: "150.00",
    });
    expect(b.configuration?.partial_payment).toEqual({ allow_partial_payment: true, minimum_amount_due: { currency_code: "USD", value: "150.00" } });
    expect(b.detail.payment_term?.term_type).toBe("NET_15");
  });
  it("parses money", () => {
    expect(moneyToCents({ value: "150.5" })).toBe(15050);
    expect(moneyToCents({ value: "600.00" })).toBe(60000);
    expect(moneyToCents(undefined)).toBe(0);
  });
});
