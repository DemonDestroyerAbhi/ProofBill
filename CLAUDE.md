# ProofBill — Project Context

> Context for coding agents working on this repo. Read before writing code.
> Working style: terse, directive. Prefer surgical diffs over full rewrites. Don't over-explain.

## 1. Product

**ProofBill — "Invoices that prove the work."**

Milestone-verified invoicing for freelancers. *The contract says what's owed, the evidence proves it's done, PayPal collects — with the proof attached.*

### Core flow
1. **Contract → terms.** Freelancer uploads SOW/contract/email thread (PDF/DOCX/text). AI extracts milestones, acceptance criteria, fees, due dates, dependencies, rate type (fixed/hourly), hourly rate, cap, payment terms (Net-N), partial-payment rules, late fee, acceptance window. Every field cites its source clause. Freelancer reviews/edits/confirms.
2. **Evidence → milestones.** Pluggable evidence sources mapped to milestones by AI (confidence + rationale), freelancer confirms:
   - GitHub merged PRs (first; App webhooks for own repos, REST polling for any public repo)
   - Deployed URL check (Kernel cloud browser screenshot vs acceptance criteria) — optional
   - Uploaded files / links (Figma, docs) — so non-dev freelancers work too
3. **Freelancer marks milestone complete → client review.** Client gets an evidence portal: each acceptance criterion with its linked evidence. Client **accepts** or **rejects with reasons**. Silence past the contract's acceptance window = accepted (sample SOW: 5 business days).
4. **Acceptance → invoice.** Amount computed **in code** from contract terms. AI writes client-readable line descriptions with evidence links. Freelancer approves → create + send via PayPal Invoicing v2.
5. **Collect.** Webhooks update status (partial/paid). Cron: overdue → PayPal `remind` with AI-written, tone-matched note; late fee per contract.

### Party model
- Freelancer = merchant. Invoices come from the freelancer's own PayPal business account; the client pays the freelancer directly. **ProofBill never holds funds** (not merchant of record, not a platform/marketplace).
- Sandbox: one US Business account = freelancer; one US Personal account = client.
- Target **direct clients** (not marketplace clients who must pay through the marketplace).
- **Hours are never inferred from commits.** Hourly work comes from user-entered time entries only.

## 2. Stack

- **Monorepo:** pnpm workspaces, TypeScript strict.
  ```
  apps/web       Next.js (App Router): app, client portal, webhook routes (/api/webhooks/paypal, /api/webhooks/github), /api/health
  apps/worker    evidence→milestone mapper, acceptance-window timer, reminders/late-fee cron
  packages/core  pricing, caps, acceptance rules, guardrails — NO LLM CALLS HERE; unit-tested
  packages/db    schema + migrations (Drizzle, Postgres)
  packages/ai    prompts, JSON schemas, evals (Gemini API, structured outputs)
  packages/paypal Invoicing v2 REST client (token cache, PayPal-Request-Id, retries) + Transaction Search via Server SDK
  packages/services workflows shared by web/worker/cron
  ```
- **Hosting:** Render — Web Service, Background Worker, Cron Job, Postgres (`render.yaml` Blueprint, Starter plans). Free alternative: see §8.
- **AI:** Gemini API (`@google/genai`), structured outputs. Store rationale + source (clause/PR) for every AI output.
- **PayPal:** Invoicing v2 over REST is the core. MCP may be used for agent reads (§9); REST fallback always.
- **GitHub:** OAuth (login), webhooks (own repos), REST polling (any public repo).
- **UI:** AG Grid (ledger; master-detail is Enterprise → trial watermark without a key). Milestone timeline is an SVG Gantt (Bryntum Gantt can replace it if licensed).

---

## 3. Data model

```
Client(id, name, email, currency)
Contract(id, clientId, sourceDocUrl, rateType[fixed|hourly], hourlyRate, cap, netDays,
         partialMinPct, lateFeePctMonthly, acceptanceWindowBizDays, terms jsonb, status)
Milestone(id, contractId, title, acceptanceCriteria jsonb, amount, dueDate, dependsOn[],
          status[planned|in_progress|submitted|accepted|rejected|invoiced|paid],
          progress, submittedAt, acceptanceDeadline, acceptedAt, acceptedBy[client|auto], rejectionReason)
Repo(id, contractId, fullName, mode[app|public_poll])
Evidence(id, milestoneId?, type[github_pr|url_check|file|link], ref, url, title, meta jsonb,
         aiSummary, aiConfidence, aiRationale, status[proposed|confirmed|rejected], capturedAt)
TimeEntry(id, milestoneId, date, hours, note)          -- user-entered only
Invoice(id, contractId, milestoneId?, paypalInvoiceId, number, amount, dueDate,
        status, sentAt, paidAt, paidAmount)
InvoiceLine(id, invoiceId, description, qty, unitAmount, evidenceIds[])
AuditEvent(id, entity, entityId, action, actor[user|client|ai|system], payload jsonb, at)
```

---

## 4. Guardrails (non-negotiable)

- AI **proposes**; human **approves** every extracted term, evidence mapping, and line item before anything is sent.
- **Amounts computed in `packages/core` from contract terms. The LLM never sets a price.**
- Contract **cap enforced** — over-cap invoice blocked.
- **Idempotency:** unique invoice numbers + `PayPal-Request-Id` header + DB uniqueness. Prove with negative test (`DUPLICATE_INVOICE_ID`).
- Webhooks: verify signature (`POST /v1/notifications/verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`); dedupe by event id.
- Everything AI did is visible in the audit log with rationale + source.
- Low-confidence evidence mappings stay `proposed` for manual mapping.

---

## 5. PayPal reference (sandbox base: `https://api-m.sandbox.paypal.com`)

| Action | Call |
|---|---|
| Token | `POST /v1/oauth2/token` (basic auth, `grant_type=client_credentials`) |
| Create draft | `POST /v2/invoicing/invoices` (+ `Prefer: return=representation`, `PayPal-Request-Id`) |
| Send | `POST /v2/invoicing/invoices/{id}/send` → payer link (fallback: `detail.metadata.recipient_view_url`) |
| Get | `GET /v2/invoicing/invoices/{id}` → `status` (`SENT`/`PARTIALLY_PAID`/`PAID`…), `payments.paid_amount`, `due_amount` |
| Remind | `POST /v2/invoicing/invoices/{id}/remind` |
| Cancel | `POST /v2/invoicing/invoices/{id}/cancel` |
| Next number | `POST /v2/invoicing/generate-next-invoice-number` |
| Negative test | header `PayPal-Mock-Response: {"mock_application_codes":"DUPLICATE_INVOICE_ID"}` (Negative Testing toggle on sandbox account) |
| Webhook events | `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.UPDATED`, `INVOICING.INVOICE.CANCELLED` |

Partial payments: `configuration.partial_payment.allow_partial_payment` + `minimum_amount_due`.
Line items: `unit_of_measure` = `AMOUNT` (fixed milestones) or `HOURS` (hourly).

---

## 6. Sandbox realities

- **MCP coverage (sandbox):** Orders, Invoices, Subscriptions, Disputes, Catalog, Shipment, Reporting. Payouts not listed → REST. Mixing MCP + REST is fine.
- **Known issue:** sandbox MCP `create_invoice` → `PAYPAL_API_SETUP_ERROR` (seen Oct 2026). REST stays the write path.
- **Disputes** can't be created in sandbox — don't depend on them.
- **Use US sandbox accounts** (same country for buyer and merchant).
- **PayPal AI Toolkit** for coding agents: `/plugin install paypal@claude-plugins-official` → `/paypal:setup`, `/paypal:sandbox`, `/paypal:test-accounts`, `/paypal:explain-error`, `/paypal:doctor`.

## 7. Repo map

- `apps/web` Next.js app (freelancer UI, client portal `/portal/:token`, webhooks, `/api/cron/:job`, `/api/health`) · `apps/worker` background loop + `reminders` cron
- `packages/core` pure rules (no LLM) · `db` Drizzle schema + migrations · `ai` Gemini prompts/schemas/eval · `paypal` Invoicing REST client + Transaction Search (Server SDK) · `services` workflows shared by web/worker
- `render.yaml` Render Blueprint (paid plans) · `.github/workflows/cron.yml` scheduled jobs for free hosting · `.claude/skills/` APIMatic PayPal Server SDK skills
- `scripts/paypal-sandbox-check.sh` standalone Invoicing v2 sandbox smoke test (token → create → idempotent replay → mocked duplicate → send → partial pay → remind → paid)
- `sample-sow.md` demo contract (Larkspur Labs; $600/$900/$700 milestones; $40/h change requests capped 20h; $3,000 cap; Net-15; partial min 25%; late fee 1.5%/mo; 5-business-day acceptance)

## 8. Implementation notes

- Extra package `packages/services`: workflows shared by web/worker/cron (contracts, evidence, milestones, invoices, ledger, seed). Every state change writes `audit_events`.
- `PAYPAL_ENV=mock` (or missing PayPal creds) → offline Invoicing simulator in Postgres (`paypal_mock_invoices`) with request-id replay, `DUPLICATE_INVOICE_ID`, partial-payment minimum and a payer page at `/mock-paypal/pay/:id`. Never used in sandbox/live.
- No `GEMINI_API_KEY` → labelled heuristic extraction/mapping + template text (`packages/ai/src/heuristics.ts`). Live check: `pnpm --filter @proofbill/ai eval`.
- Change-request hourly clause on a fixed contract becomes an extra hourly milestone ("Change requests (hourly)") at confirm time.
- One live invoice per milestone (partial unique index). Hourly milestone = one invoice; more hours later → add another hourly milestone.
- Late fees: separate invoice `…-LF<n>` per full 30 days overdue, simple interest on outstanding balance, excluded from cap.
- Timeline is an SVG Gantt. Bryntum's npm package is private/licensed — swap in if a license is available.
- Judge mode: `POST /api/auth/demo` → shared demo user + seeded Larkspur workspace (`DEMO_MODE=off` disables). Demo invoices go to `PAYER_EMAIL`. Seeded PRs are sample evidence without links; connect any public repo for real PRs.
- No per-deploy identity config: freelancer display name = user's name (Settings page `/app/settings`, defaults to GitHub name).
- Tests: `packages/services/test/flow.test.ts` drives the whole flow against a real Postgres (`TEST_DATABASE_URL`, schema dropped each run).
- APIMatic Context Plugin (PayPal Server SDK, TS skills) vendored in `.claude/skills/` — loads in every session. Covers Orders/Payments/Vault/Subscriptions/Transaction Search via `@paypal/paypal-server-sdk`; **not Invoicing**. Load `typescript-getting-started` first when touching the Server SDK.
- Reconciliation: `packages/paypal/src/transactions.ts` uses `@paypal/paypal-server-sdk@2.5.0` (pinned) `TransactionSearchController` → `invoice_payments` + `invoices.fee_cents/net_cents/reconcile_status`. Runs after a payment webhook (best-effort), in the collections cron, and from the invoice page. Needs **Transaction search** permission on the PayPal app. Mock mode simulates fees at 3.49% + $0.49.
- PayPal webhooks: dedupe skips only *processed* events — PayPal retries non-2xx up to 25× over 3 days, so an unverified/errored delivery is reprocessed on retry. Unverified → 401 (PayPal retries).
- Sandbox (kickoff session): app feature toggles (Transaction search etc.) take up to ~10 min to apply; webhook is per app per environment (recreate for live); local webhook testing needs a tunnel (ngrok / cloudflared) to :3000; debug via Developer Dashboard → Event logs (API calls, errors, webhook deliveries + resend) and Sandbox notifications.
- Free hosting (no card; Render Blueprints need one): Render **Web Service** (Free) + **Neon** Postgres + **GitHub Actions** (`.github/workflows/cron.yml`) calling `POST /api/cron/{tick,collections}` with `Authorization: Bearer $CRON_SECRET`. Start command `pnpm start:web` runs migrations first. `render.yaml` stays as the paid option.

## 9. Planned: PayPal MCP in "Ask the ledger"

Goal: Gemini reasons; PayPal's own MCP server supplies live PayPal data. Read-only.
- **Server:** `https://mcp.sandbox.paypal.com/sse` (SSE), header `Authorization: Bearer <access token>` (from `paypal/ai-toolkit` `.mcp.json`). Env `PAYPAL_MCP_URL` (default sandbox).
- **Token:** reuse `PayPalRestClient.accessToken()` (client-credentials, auto-refresh) → no 9h manual refresh.
- **Client:** `packages/paypal/src/mcp.ts` with `@modelcontextprotocol/sdk` `Client` + `SSEClientTransport`; `tools/list` at connect (exact tool names unknown until then — invoice tools are "7 invoice tools", reporting has `list_transactions`).
- **Guardrail:** allowlist read-only tools only (list/get/search: invoices, transactions, disputes). Never expose create/send/pay/cancel/refund tools — sending stays behind human-approved UI.
- **Assistant:** merge allowlisted MCP tools into Gemini `functionDeclarations` (MCP `inputSchema` → `parametersJsonSchema`, prefix `paypal_`), dispatch via `callTool`; keep our DB tools (`list_receivables`, `list_milestones`). UI trace shows "via PayPal MCP".
- **Fallback:** mock mode, connect failure or 401 → current REST/Server-SDK tools. Log which path answered.
- **Tests:** in-memory MCP server (SDK `InMemoryTransport`) to test allowlist filtering + dispatch + fallback.
- **Risks:** SSE transport is legacy in the MCP spec (SDK still supports it); tool names/schemas may change; sandbox MCP `create_invoice` bug irrelevant (read-only).
- Est. ~half a day.
