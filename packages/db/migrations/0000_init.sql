CREATE TYPE "public"."accepted_by" AS ENUM('client', 'auto');--> statement-breakpoint
CREATE TYPE "public"."actor" AS ENUM('user', 'client', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('proposed', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('github_pr', 'url_check', 'file', 'link');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('milestone', 'late_fee');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('planned', 'in_progress', 'submitted', 'accepted', 'rejected', 'invoiced', 'paid');--> statement-breakpoint
CREATE TYPE "public"."rate_type" AS ENUM('fixed', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."repo_mode" AS ENUM('app', 'public_poll');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"actor" "actor" NOT NULL,
	"summary" text NOT NULL,
	"rationale" text,
	"source" jsonb,
	"payload" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"source_doc_name" text,
	"source_text" text NOT NULL,
	"rate_type" "rate_type" DEFAULT 'fixed' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"hourly_rate_cents" integer,
	"hourly_cap_hours" integer,
	"total_cap_cents" integer,
	"net_days" integer DEFAULT 15 NOT NULL,
	"partial_min_pct" numeric,
	"late_fee_pct_monthly" numeric,
	"acceptance_window_biz_days" integer DEFAULT 5 NOT NULL,
	"extracted" jsonb,
	"extracted_by" text,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"portal_token" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_code_unique" UNIQUE("code"),
	CONSTRAINT "contracts_portal_token_unique" UNIQUE("portal_token")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"milestone_id" uuid,
	"type" "evidence_type" NOT NULL,
	"ref" text NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_summary" text,
	"ai_confidence" real,
	"ai_rationale" text,
	"ai_criteria" jsonb,
	"mapped_at" timestamp with time zone,
	"status" "evidence_status" DEFAULT 'proposed' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"quantity" text NOT NULL,
	"unit_of_measure" text NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"description_by" "actor" DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"milestone_id" uuid,
	"kind" "invoice_kind" DEFAULT 'milestone' NOT NULL,
	"parent_invoice_id" uuid,
	"late_fee_period" integer,
	"paypal_invoice_id" text,
	"number" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"minimum_payment_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"payer_view_url" text,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_paypal_invoice_id_unique" UNIQUE("paypal_invoice_id"),
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"billing" "rate_type" DEFAULT 'fixed' NOT NULL,
	"amount_cents" integer,
	"due_date" date,
	"depends_on" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"status" "milestone_status" DEFAULT 'planned' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"submission_note" text,
	"acceptance_deadline" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by" "accepted_by",
	"rejection_reason" text,
	"source" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paypal_mock_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text,
	"number" text NOT NULL,
	"body" jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paypal_mock_invoices_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "paypal_mock_invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"mode" "repo_mode" DEFAULT 'public_poll' NOT NULL,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"date" date NOT NULL,
	"hours_x100" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" text,
	"login" text NOT NULL,
	"name" text,
	"email" text,
	"avatar_url" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_contract_idx" ON "audit_events" USING btree ("contract_id","at");--> statement-breakpoint
CREATE INDEX "contracts_user_idx" ON "contracts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_contract_type_ref_uq" ON "evidence" USING btree ("contract_id","type","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_live_per_milestone_uq" ON "invoices" USING btree ("milestone_id") WHERE kind = 'milestone' AND status <> 'CANCELLED';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_late_fee_period_uq" ON "invoices" USING btree ("parent_invoice_id","late_fee_period");--> statement-breakpoint
CREATE INDEX "invoices_contract_idx" ON "invoices" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_contract_number_uq" ON "milestones" USING btree ("contract_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_contract_name_uq" ON "repos" USING btree ("contract_id","full_name");--> statement-breakpoint
CREATE INDEX "repos_full_name_idx" ON "repos" USING btree ("full_name");