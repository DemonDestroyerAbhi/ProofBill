# ProofBill — Project Context

> Handoff doc for Claude Code. Put at repo root. Read fully before writing code.
> Owner: Abhishek (Pune, IST, UTC+5:30). Full-stack TypeScript/Node, Salesforce background.
> Working style: terse, directive. Prefer surgical diffs over full rewrites. Don't over-explain.

---

## 1. Hackathon

**PayPal AI Hackathon** — "Build what's next with PayPal and AI" (Devpost, paypalaihackathon.devpost.com)

- **Deadline:** Nov 13, 2026 @ 01:30 IST (= Nov 12, 12:00 PT). Internal deadline: **Nov 11**.
- **Must:** meaningfully use ≥1 PayPal technology (sandbox) **and** AI; working prototype; documented.
- **Submit:** text description · functional demo (hosted URL **or** complete run instructions) · tools used + how · **public repo with LICENSE visible in About** · **YouTube demo video < 3 min**, public, no third-party copyrighted music/marks.
- New or existing projects OK if meaningful progress during the hackathon. Mockups/static prototypes don't qualify.

**Judging criteria:** Technological Implementation · Design (complete product, not a PoC) · Potential Impact (specific problem, real audience) · Innovation/Idea · Presentation (video end-to-end, problem/who/why).

**Prizes:** 1st $12k · 2nd $8k · 3rd $5k · $5k each: Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce · AG Grid $5k/$2k/3×$1k · APIMatic 3×$1k (+6mo sub) · Bryntum 3×$1k · Channel3 $1.5k · Render credits $1k/$750/$500.

**Our targets:** Best Use of PayPal + AI, Most Impactful, AG Grid, Bryntum, APIMatic, Render. (Agentic Commerce unlikely — this is AI-assisted invoicing, not an agent transacting.)

---

## 2. Product

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

### Positioning
- **Party model:** freelancer = merchant. Invoices come from the freelancer's own PayPal business account; client pays freelancer directly. **ProofBill never holds funds** (not merchant of record, not a platform/marketplace).
  - Hackathon: one sandbox US Business account = demo freelancer; sandbox US Personal account = client.
  - Production (README only): each freelancer connects their PayPal via partner onboarding with third-party invoicing permissions; ProofBill calls Invoicing on their behalf. *Confirm exact permission scope with PayPal in Discord before writing this.*
  - Pitch line: *"ProofBill never holds your money. Clients pay you directly through PayPal; we just make sure the invoice proves the work."*
- **vs MergePay** (GitHub issue bounties → Payouts after AI PR review): same "merge → money" demo moment is a real Innovation risk. Differentiate by:
  1. Lead pitch/video with **contract extraction**, not the PR merge.
  2. Evidence is **pluggable**, not code-only.
  3. The **client acceptance portal** is the hero — MergePay has no client relationship.
  4. README line: *"Unlike bounty tools (e.g. MergePay), ProofBill handles client contracts — invoicing against agreed milestones, client acceptance, partial payments, reminders."*
  - TODO: check MergePay's Devpost/repo; if it does milestones/invoicing, push further toward non-dev evidence.
- **Don't** pitch Upwork as an input — Upwork clients pay through Upwork; off-platform invoicing violates their circumvention rules. Target **direct clients**.
- **Hours are never inferred from commits.** Hourly work comes from user-entered time entries only.

---

## 3. Stack

- **Monorepo:** pnpm workspaces, TypeScript strict.
  ```
  apps/web       Next.js (App Router): app, client portal, webhook routes (/api/webhooks/paypal, /api/webhooks/github), /api/health
  apps/worker    evidence→milestone mapper, acceptance-window timer, reminders/late-fee cron
  packages/core  pricing, caps, acceptance rules, guardrails — NO LLM CALLS HERE; unit-tested
  packages/db    schema + migrations (Drizzle or Prisma, Postgres)
  packages/ai    prompts, JSON schemas, evals (Gemini API, structured outputs)
  packages/paypal REST client (token cache, PayPal-Request-Id, retries) + Agent Toolkit/MCP wrapper
  ```
- **Hosting:** Render — Web Service, Background Worker, Cron Job, Postgres (`render.yaml` Blueprint for one-click deploy). **Starter plans on credits** (free Postgres expires ~30 days; workers/crons not free; free web sleeps). Confirm plan names in dashboard.
- **AI:** Gemini API (`@google/genai`), structured outputs. *(Switched from Claude Oct 8 — Gemini is the only LLM for now.)* Store rationale + source (clause/PR) for every AI output.
- **PayPal:** Invoicing v2 over **REST = dependable core**. Agent Toolkit/MCP for agent actions where it works; **REST fallback always**.
- **GitHub:** GitHub OAuth (login), GitHub App (webhooks, own repos), REST polling (public repos judges paste).
- **UI:** AG Grid (ledger; master-detail is Enterprise → trial watermark OK, no penalty). Bryntum Gantt (milestone timeline) — **license through Dec 15 unconfirmed; fallback = AG Grid timeline**.

---

## 4. Data model

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

## 5. Guardrails (non-negotiable — the pitch depends on them)

- AI **proposes**; human **approves** every extracted term, evidence mapping, and line item before anything is sent.
- **Amounts computed in `packages/core` from contract terms. The LLM never sets a price.**
- Contract **cap enforced** — over-cap invoice blocked.
- **Idempotency:** unique invoice numbers + `PayPal-Request-Id` header + DB uniqueness. Prove with negative test (`DUPLICATE_INVOICE_ID`).
- Webhooks: verify signature (`POST /v1/notifications/verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`); dedupe by event id.
- Everything AI did is visible in the audit log with rationale + source.
- Low-confidence evidence mappings stay `proposed` for manual mapping.

---

## 6. PayPal reference (sandbox base: `https://api-m.sandbox.paypal.com`)

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

## 7. Sandbox realities (from Discord / webinar / docs)

- **MCP coverage (sandbox):** Orders, Invoices, Subscriptions, Disputes, Catalog, Shipment, Reporting. **Payouts not listed → REST.** Mixing MCP + REST is fine (PayPal DevRel).
- **Invoicing alone counts as central.** JS SDK v6 not required.
- **Known bug:** MCP `create_invoice` → `PAYPAL_API_SETUP_ERROR` since ~Oct 6. Keep REST fallback. Re-check status.
- **Disputes** can't be created in sandbox (`GRANT_PROXY_CLIENT`) — don't depend on them.
- **Agent Ready / Store Sync / Cart API** sandbox access unconfirmed.
- **AI Toolkit in Claude Code:** `/plugin install paypal@claude-plugins-official` → `/paypal:setup`, `/paypal:sandbox`, `/paypal:test-accounts`, `/paypal:explain-error`, `/paypal:doctor`.
- **Use US sandbox accounts.** IN accounts are cross-border-only and may restrict Invoicing/Payouts.
- AG Grid: watermark not penalized; AG Studio live updates ~Oct 28.
- Bryntum: scheduling webinar Oct 15; trial-through-judging unconfirmed.
- Render: credits via "start building with $50" link in Discord #render.
- Judges probe **buyer vs merchant coherence** — keep the party model clean (§2).

---

## 8. Sponsor usage (genuine only)

| Sponsor | Role | Prize |
|---|---|---|
| AG Grid | Receivables ledger: rows = line items (milestone, evidence, hours, amount, status, days overdue); master-detail = evidence. Optional AG Studio agent ("what's unpaid on Larkspur?") | Yes |
| Bryntum | Gantt of milestones: dependencies, due dates, invoice-due markers; progress driven by confirmed evidence; acceptance window visible | Yes (license risk) |
| Render | Web + Worker + Cron + Postgres; one-click Blueprint for judges | Credits |
| APIMatic | Context Plugins in coding agent while building PayPal integration — document in Tools section | Yes |
| Kernel | URL-check evidence (live-site screenshot vs criteria) | No prize; optional |
| Postman | Publish API collection for judges | No prize; optional |

Skip: Channel3, Zapier, Elastic, Astropods.

---

## 9. Plan

| Week | Dates | Deliverable |
|---|---|---|
| 0 | Oct 8–10 | Validation (§10) |
| 1 | Oct 11–17 | Monorepo, GitHub OAuth, Postgres, Render deploy day 1. Contract upload → extraction (strict JSON schema + source clauses) → review/confirm UI |
| 2 | Oct 18–24 | Evidence: GitHub App webhooks + public polling → AI mapping (confidence/rationale) → confirm. File/link evidence. Time entries. AG Grid ledger |
| 3 | Oct 25–31 | Submit milestone → client evidence portal → accept/reject/auto-accept timer → invoice (code-computed amount, AI lines, evidence links) → send → webhooks (partial/paid) → cron reminders + late fee. Negative tests. Audit log |
| 4 | Nov 1–7 | Bryntum Gantt (or AG Grid fallback). Optional Kernel URL check. Design pass on client portal. Judge mode (seeded workspace + bring-your-own contract & public repo). Demo assets |
| 5 | Nov 8–11 | **Feature freeze Nov 8.** README (setup, env, architecture diagram, tools & how, MergePay note), LICENSE. Video Nov 9–10. **Submit Nov 11** |

**Cut order if behind:** Bryntum → Kernel URL check → late fees → partial payments → time entries.

---

## 10. Week 0 status

Done:
- [x] PayPal developer login works (Indian-number signup blocker does **not** apply)
- [x] Sandbox **US Business** (freelancer) + **US Personal** (client) accounts created
- [x] REST app **ProofBill**, type **Merchant**, linked to US Business account

Next:
- [ ] Copy Client ID/Secret → `.env`; tick **Invoicing, Transaction search, Payouts** on the app
- [ ] Enable Negative Testing on the US Business sandbox account
- [ ] Note US Personal email/password → `PAYER_EMAIL`
- [ ] Add webhook (webhook.site for now) → save `PAYPAL_WEBHOOK_ID`
- [ ] Run `./week0-paypal-check.sh` → must reach **PAID**; confirm UPDATED + PAID events
- [ ] MCP check via Claude Code plugin: create/send/list invoice — record which tools work
- [ ] GitHub fine-grained read-only token; fetch merged PRs
- [ ] Public demo repo `larkspur-invoice-export` matching `sample-sow.md` + 2–3 staged PRs
- [ ] Render: claim credits, placeholder web with `/api/health` + `/api/webhooks/paypal` (log body); repoint PayPal webhook; confirm delivery
- [ ] Repo `proofbill` public, MIT LICENSE (set in About), commit `render.yaml`, `.env.example`
- [ ] AI spike: extract every `sample-sow.md` field with source clause
- [ ] Discord: #bryntum license question; #general MCP invoice bug status
- [ ] Devpost: register, draft project "ProofBill", search gallery for invoice/milestone/contract; check MergePay

**Go/no-go (Sat Oct 10):** billing loop reaches PAID with partial payment · webhooks arrive on Render · merged PRs fetched · AI extracts all SOW fields · Bryntum answered or fallback accepted. **If PayPal or webhooks fail, fix before writing app code.**

---

## 11. Demo video (< 3 min)

| Time | Shot |
|---|---|
| 0:00 | Problem: freelancers chase payments; clients dispute what was delivered |
| 0:20 | Upload SOW → milestones, fees, cap, Net-15, acceptance window extracted with source clauses |
| 0:50 | Evidence attaches: merge a PR live → maps to Milestone 1 with rationale; a Figma/file link on another |
| 1:15 | Freelancer submits milestone → client portal: criteria ✓ with evidence → client accepts |
| 1:40 | Invoice auto-built (code-computed amount, AI lines, evidence links) → approve → sent via PayPal |
| 2:00 | Client pays partial with sandbox account → webhook → ledger + Gantt update |
| 2:25 | Overdue reminder (AI note via PayPal remind) |
| 2:40 | Guardrails: over-cap blocked, duplicate rejected, audit log |

---

## 12. Risks

| Risk | Fallback |
|---|---|
| MCP invoice tools broken | REST for writes; MCP for agent reads |
| MergePay looks similar | §2 differentiation; lead with contract + client portal |
| Bryntum license | AG Grid timeline |
| Evidence mapping wrong | Confidence threshold; stays `proposed` |
| Scope slip | Cut order (§9) |

---

## 13. Files in this handoff

- `week0-paypal-check.sh` — end-to-end Invoicing v2 sandbox validation (token, create, idempotent replay, mocked duplicate, send, partial pay, remind, pay balance)
- `render.yaml` — Blueprint (web, worker, cron, Postgres; Starter plans; confirm plan names)
- `.env.example` — all env vars
- `sample-sow.md` — demo contract (Larkspur Labs; 3 milestones $600/$900/$700; $40/h change requests capped 20h; total cap $3,000; Net-15; partial min 25%; late fee 1.5%/mo; 5-business-day acceptance)

---

## 14. Implementation notes (build log)

- Extra package `packages/services`: workflows shared by web/worker/cron (contracts, evidence, milestones, invoices, ledger, seed). Every state change writes `audit_events`.
- `PAYPAL_ENV=mock` (or missing PayPal creds) → offline Invoicing simulator in Postgres (`paypal_mock_invoices`) with request-id replay, `DUPLICATE_INVOICE_ID`, partial-payment minimum and a payer page at `/mock-paypal/pay/:id`. Never used in sandbox/live.
- No `GEMINI_API_KEY` → labelled heuristic extraction/mapping + template text (`packages/ai/src/heuristics.ts`). Live check: `pnpm --filter @proofbill/ai eval`.
- Change-request hourly clause on a fixed contract becomes an extra hourly milestone ("Change requests (hourly)") at confirm time.
- One live invoice per milestone (partial unique index). Hourly milestone = one invoice; more hours later → add another hourly milestone.
- Late fees: separate invoice `…-LF<n>` per full 30 days overdue, simple interest on outstanding balance, excluded from cap.
- Timeline is an SVG Gantt (Bryntum fallback). Bryntum's npm package is private/licensed — swap in if the license is confirmed.
- Judge mode: `POST /api/auth/demo` → shared demo user + seeded Larkspur workspace (`DEMO_MODE=off` disables). Demo invoices go to `PAYER_EMAIL`.
- Tests: `packages/services/test/flow.test.ts` drives the whole flow against a real Postgres (`TEST_DATABASE_URL`, schema dropped each run).
