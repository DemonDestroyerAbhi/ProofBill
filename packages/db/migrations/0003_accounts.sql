CREATE TYPE "public"."user_role" AS ENUM('freelancer', 'client');--> statement-breakpoint
CREATE TABLE "client_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'freelancer' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_links_user_contract_uq" ON "client_links" USING btree ("user_id","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_password_email_uq" ON "users" USING btree (lower("email")) WHERE password_hash IS NOT NULL;