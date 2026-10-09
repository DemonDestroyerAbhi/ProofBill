CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"status" text NOT NULL,
	"event_code" text,
	"initiated_at" timestamp with time zone,
	"gross_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "fee_cents" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "net_cents" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reconcile_status" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paypal_mock_invoices" ADD COLUMN "payments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_txn_uq" ON "invoice_payments" USING btree ("invoice_id","transaction_id");