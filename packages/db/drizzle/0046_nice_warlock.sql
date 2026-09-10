CREATE TABLE "agent_records" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"template_id" text,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spec" jsonb NOT NULL,
	"status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_budgets" (
	"owner" text PRIMARY KEY NOT NULL,
	"cpu" text NOT NULL,
	"memory" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_records_owner_idx" ON "agent_records" USING btree ("owner");