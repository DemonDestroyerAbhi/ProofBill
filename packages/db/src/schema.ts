import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const rateType = pgEnum("rate_type", ["fixed", "hourly"]);
export const contractStatus = pgEnum("contract_status", ["draft", "active", "completed", "cancelled"]);
export const milestoneStatus = pgEnum("milestone_status", [
  "planned",
  "in_progress",
  "submitted",
  "accepted",
  "rejected",
  "invoiced",
  "paid",
]);
export const acceptedBy = pgEnum("accepted_by", ["client", "auto"]);
export const repoMode = pgEnum("repo_mode", ["app", "public_poll"]);
export const evidenceType = pgEnum("evidence_type", ["github_pr", "url_check", "file", "link"]);
export const evidenceStatus = pgEnum("evidence_status", ["proposed", "confirmed", "rejected"]);
export const invoiceKind = pgEnum("invoice_kind", ["milestone", "late_fee"]);
export const actor = pgEnum("actor", ["user", "client", "ai", "system"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export interface SourceRefJson {
  section: string;
  quote: string;
}

export const userRole = pgEnum("user_role", ["freelancer", "client"]);

export const users = pgTable(
  "users",
  {
    id: id(),
    githubId: text("github_id").unique(),
    login: text("login").notNull(),
    name: text("name"),
    email: text("email"),
    /** scrypt hash for email/password accounts; null for GitHub-only and demo users. */
    passwordHash: text("password_hash"),
    role: userRole("role").notNull().default("freelancer"),
    avatarUrl: text("avatar_url"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  // One password account per email (case-insensitive).
  (t) => [uniqueIndex("users_password_email_uq").on(sql`lower(${t.email})`).where(sql`password_hash IS NOT NULL`)],
);

export const clients = pgTable("clients", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  currency: text("currency").notNull().default("USD"),
  createdAt: createdAt(),
});

export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id),
    /** Short human code used in invoice numbers, e.g. LARK7Q. */
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    sourceDocName: text("source_doc_name"),
    sourceText: text("source_text").notNull(),
    rateType: rateType("rate_type").notNull().default("fixed"),
    currency: text("currency").notNull().default("USD"),
    hourlyRateCents: integer("hourly_rate_cents"),
    hourlyCapHours: integer("hourly_cap_hours"),
    totalCapCents: integer("total_cap_cents"),
    netDays: integer("net_days").notNull().default(15),
    partialMinPct: numeric("partial_min_pct", { mode: "number" }),
    lateFeePctMonthly: numeric("late_fee_pct_monthly", { mode: "number" }),
    acceptanceWindowBizDays: integer("acceptance_window_biz_days").notNull().default(5),
    /** Raw AI extraction incl. per-field source clauses, kept for audit. */
    extracted: jsonb("extracted"),
    extractedBy: text("extracted_by"),
    status: contractStatus("status").notNull().default("draft"),
    portalToken: text("portal_token").notNull().unique(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("contracts_user_idx").on(t.userId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
    billing: rateType("billing").notNull().default("fixed"),
    amountCents: integer("amount_cents"),
    dueDate: date("due_date"),
    dependsOn: integer("depends_on").array().notNull().default(sql`'{}'::integer[]`),
    status: milestoneStatus("status").notNull().default("planned"),
    progress: integer("progress").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submissionNote: text("submission_note"),
    acceptanceDeadline: timestamp("acceptance_deadline", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: acceptedBy("accepted_by"),
    rejectionReason: text("rejection_reason"),
    source: jsonb("source").$type<SourceRefJson | null>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("milestones_contract_number_uq").on(t.contractId, t.number)],
);

export const repos = pgTable(
  "repos",
  {
    id: id(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    mode: repoMode("mode").notNull().default("public_poll"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("repos_contract_name_uq").on(t.contractId, t.fullName), index("repos_full_name_idx").on(t.fullName)],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
    type: evidenceType("type").notNull(),
    /** Stable external reference, e.g. "owner/repo#12" — dedupe key. */
    ref: text("ref").notNull(),
    url: text("url"),
    title: text("title").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    aiSummary: text("ai_summary"),
    aiConfidence: real("ai_confidence"),
    aiRationale: text("ai_rationale"),
    aiCriteria: jsonb("ai_criteria").$type<string[]>(),
    mappedAt: timestamp("mapped_at", { withTimezone: true }),
    status: evidenceStatus("status").notNull().default("proposed"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("evidence_contract_type_ref_uq").on(t.contractId, t.type, t.ref)],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Uploaded evidence files (designs, docs, screenshots) — so non-dev freelancers have evidence too. Small files only. */
export const evidenceFiles = pgTable("evidence_files", {
  id: id(),
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: createdAt(),
});

export const timeEntries = pgTable("time_entries", {
  id: id(),
  milestoneId: uuid("milestone_id").notNull().references(() => milestones.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  hoursX100: integer("hours_x100").notNull(),
  note: text("note").notNull().default(""),
  invoiceId: uuid("invoice_id"),
  createdAt: createdAt(),
});

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id),
    kind: invoiceKind("kind").notNull().default("milestone"),
    parentInvoiceId: uuid("parent_invoice_id"),
    lateFeePeriod: integer("late_fee_period"),
    paypalInvoiceId: text("paypal_invoice_id").unique(),
    number: text("number").notNull().unique(),
    amountCents: integer("amount_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    minimumPaymentCents: integer("minimum_payment_cents"),
    currency: text("currency").notNull().default("USD"),
    dueDate: date("due_date"),
    /** "draft" until created on PayPal, then mirrors PayPal status (SENT, PARTIALLY_PAID, PAID, …). */
    status: text("status").notNull().default("draft"),
    note: text("note"),
    payerViewUrl: text("payer_view_url"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    reminderCount: integer("reminder_count").notNull().default(0),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** Transaction Search reconciliation: PayPal's fee and what actually landed, from matched transactions. */
    feeCents: integer("fee_cents"),
    netCents: integer("net_cents"),
    /** matched | pending (search lags up to 3h) | mismatch */
    reconcileStatus: text("reconcile_status"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live invoice per milestone. Cancelled ones don't count, so a cancelled invoice can be re-issued.
    uniqueIndex("invoices_one_live_per_milestone_uq")
      .on(t.milestoneId)
      .where(sql`kind = 'milestone' AND status <> 'CANCELLED'`),
    uniqueIndex("invoices_late_fee_period_uq").on(t.parentInvoiceId, t.lateFeePeriod),
    index("invoices_contract_idx").on(t.contractId),
  ],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: id(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  quantity: text("quantity").notNull(),
  unitOfMeasure: text("unit_of_measure").notNull(),
  unitAmountCents: integer("unit_amount_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  evidenceIds: uuid("evidence_ids").array().notNull().default(sql`'{}'::uuid[]`),
  descriptionBy: actor("description_by").notNull().default("system"),
});

/** PayPal transactions that paid an invoice, found via Transaction Search (PayPal Server SDK). */
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id").notNull(),
    status: text("status").notNull(),
    eventCode: text("event_code"),
    initiatedAt: timestamp("initiated_at", { withTimezone: true }),
    grossCents: integer("gross_cents").notNull(),
    feeCents: integer("fee_cents").notNull(),
    netCents: integer("net_cents").notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoice_payments_txn_uq").on(t.invoiceId, t.transactionId)],
);

/**
 * A client account's saved portals, across freelancers. A row is created only when the signed-in
 * client opens the contract's portal link — possession of the link is the proof, not the email.
 */
export const clientLinks = pgTable(
  "client_links",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("client_links_user_contract_uq").on(t.userId, t.contractId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    contractId: uuid("contract_id"),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    actor: actor("actor").notNull(),
    summary: text("summary").notNull(),
    rationale: text("rationale"),
    source: jsonb("source"),
    payload: jsonb("payload"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_contract_idx").on(t.contractId, t.at)],
);

export const webhookEvents = pgTable("webhook_events", {
  /** Provider event id (PayPal event id / GitHub delivery id) — the dedupe key. */
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  verified: boolean("verified").notNull().default(false),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Offline PayPal simulator state — used ONLY when PAYPAL_ENV=mock (no sandbox credentials).
 * Lets the full flow run locally and in CI; never touched in sandbox/live mode.
 */
export const paypalMockInvoices = pgTable("paypal_mock_invoices", {
  id: text("id").primaryKey(),
  requestId: text("request_id").unique(),
  number: text("number").notNull().unique(),
  body: jsonb("body").notNull(),
  status: text("status").notNull().default("DRAFT"),
  paidCents: integer("paid_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  /** Simulated Transaction Search rows for this invoice's payments. */
  payments: jsonb("payments").$type<unknown[]>().notNull().default([]),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InvoicePayment = typeof invoicePayments.$inferSelect;
