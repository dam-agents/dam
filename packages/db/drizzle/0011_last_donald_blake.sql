CREATE TABLE "egress_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"host" text NOT NULL,
	"method" text NOT NULL,
	"path_pattern" text NOT NULL,
	"verdict" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"instance_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"owner_sub" text NOT NULL,
	"session_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"verdict" text,
	"decided_by" text,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "egress_rules_lookup_idx" ON "egress_rules" USING btree ("agent_id","host","method","path_pattern") WHERE "egress_rules"."status" = 'active';--> statement-breakpoint
CREATE INDEX "pending_approvals_owner_status_idx" ON "pending_approvals" USING btree ("owner_sub","status");--> statement-breakpoint
CREATE INDEX "pending_approvals_instance_status_idx" ON "pending_approvals" USING btree ("instance_id","status");