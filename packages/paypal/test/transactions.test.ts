import { describe, expect, it } from "vitest";
import { TransactionSearchLookup, TransactionSearchError, createServerSdkClient, searchWindows, summarisePayments } from "../src";

type Reply = { status: number; body: unknown };

/** Stub adapter per the typescript-testing skill: capture every request, return raw serialized bodies. */
function lookupWith(replies: (url: string) => Reply) {
  const requests: { url: string; params?: Record<string, unknown> }[] = [];
  const client = createServerSdkClient({
    clientId: "id",
    clientSecret: "secret",
    env: "sandbox",
    // Seed an unexpired token so no token exchange goes through the adapter.
    seedToken: { accessToken: "seeded", tokenType: "Bearer", expiry: BigInt(Math.floor(Date.now() / 1000) + 3600) },
    unstableHttpClientOptions: {
      adapter: async (config: { url: string; params?: Record<string, unknown> }) => {
        requests.push({ url: config.url, params: config.params });
        const r = replies(config.url);
        return { data: JSON.stringify(r.body), status: r.status, statusText: "", headers: { "content-type": "application/json" }, config };
      },
    },
  });
  return { lookup: new TransactionSearchLookup({ client, env: "sandbox" }), requests };
}

const txn = (id: string, opts: { invoice?: string; ppInvoice?: string; gross: string; fee: string; status?: string; at?: string }) => ({
  transaction_info: {
    transaction_id: id,
    transaction_event_code: "T0007",
    transaction_initiation_date: opts.at ?? "2026-10-24T10:00:00+0000",
    transaction_amount: { currency_code: "USD", value: opts.gross },
    fee_amount: { currency_code: "USD", value: opts.fee },
    transaction_status: opts.status ?? "S",
    ...(opts.invoice ? { invoice_id: opts.invoice } : {}),
  },
  ...(opts.ppInvoice ? { cart_info: { paypal_invoice_id: opts.ppInvoice } } : {}),
});

const args = { paypalInvoiceId: "INV2-AAAA-BBBB", invoiceNumber: "PB-LARK7Q-M1", since: new Date("2026-10-20T00:00:00Z"), until: new Date("2026-10-30T00:00:00Z") };

describe("Transaction Search reconciliation (PayPal Server SDK)", () => {
  it("finds the invoice's payments by PayPal invoice id or invoice number, with fees and net", async () => {
    const { lookup, requests } = lookupWith(() => ({
      status: 200,
      body: {
        transaction_details: [
          txn("1AA11111AA1111111", { ppInvoice: "INV2-AAAA-BBBB", gross: "150.00", fee: "-5.73" }),
          txn("2BB22222BB2222222", { invoice: "PB-LARK7Q-M1", gross: "450.00", fee: "-16.19", at: "2026-10-26T10:00:00+0000" }),
          txn("3CC33333CC3333333", { invoice: "SOMEONE-ELSE", gross: "99.00", fee: "-3.94" }),
        ],
        page: 1,
        total_pages: 1,
      },
    }));
    const ps = await lookup.findInvoicePayments(args);
    expect(ps.map((p) => [p.transactionId, p.grossCents, p.feeCents, p.netCents])).toEqual([
      ["1AA11111AA1111111", 15000, 573, 14427],
      ["2BB22222BB2222222", 45000, 1619, 43381],
    ]);
    expect(summarisePayments(ps)).toEqual({ grossCents: 60000, feeCents: 2192, netCents: 57808, completed: 2 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toContain("/v1/reporting/transactions");
    expect(requests[0]!.url).toContain("start_date=2026-10-20T00%3A00%3A00Z");
    expect(requests[0]!.url).toContain("fields=transaction_info%2Ccart_info");
  });

  it("pages until total_pages and splits windows longer than 31 days", async () => {
    let call = 0;
    const { lookup, requests } = lookupWith(() => {
      call++;
      const full = Array.from({ length: 100 }, (_, i) => txn(`X${call}-${i}`, { invoice: "other", gross: "1.00", fee: "0.00" }));
      if (call === 1) return { status: 200, body: { transaction_details: full, page: 1, total_pages: 2 } };
      if (call === 2) return { status: 200, body: { transaction_details: [txn("PAGE2", { invoice: "PB-LARK7Q-M1", gross: "600.00", fee: "-21.43" })], page: 2, total_pages: 2 } };
      return { status: 200, body: { transaction_details: [], page: 1, total_pages: 1 } };
    });
    const ps = await lookup.findInvoicePayments({ ...args, until: new Date("2026-12-15T00:00:00Z") });
    expect(ps.map((p) => p.transactionId)).toEqual(["PAGE2"]);
    expect(requests.length).toBe(3); // window 1 (31 days): 2 pages; window 2: 1 page
    expect(searchWindows(args.since, new Date("2026-12-15T00:00:00Z"))).toHaveLength(2);
  });

  it("maps PayPal errors to a typed SearchError → TransactionSearchError", async () => {
    const { lookup } = lookupWith(() => ({
      status: 400,
      body: { name: "INVALID_REQUEST", message: "Request is not well-formed", debug_id: "abc", details: [{ issue: "INVALID_DATE_RANGE" }] },
    }));
    const err = await lookup.findInvoicePayments(args).catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSearchError);
    expect(err).toMatchObject({ status: 400, issue: "INVALID_DATE_RANGE" });
  });

  it("ignores pending/reversed transactions in the totals", () => {
    expect(
      summarisePayments([
        { transactionId: "a", status: "S", eventCode: null, initiatedAt: null, grossCents: 100, feeCents: 4, netCents: 96, currency: "USD" },
        { transactionId: "b", status: "P", eventCode: null, initiatedAt: null, grossCents: 500, feeCents: 0, netCents: 500, currency: "USD" },
      ]),
    ).toEqual({ grossCents: 100, feeCents: 4, netCents: 96, completed: 1 });
  });
});
