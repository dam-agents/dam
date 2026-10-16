-- Spend Limits: the owner's daily maximum for an agent, for all own agents,
-- or for one agent and Connection. The ext_authz gate reads them on each
-- billable model call. An Extension is one "continue" for one limit on one
-- UTC day; it goes away with its limit. A limit is deleted with its agent.
CREATE TABLE "spend_limit_extensions" (
	"limit_id" text NOT NULL,
	"day" date NOT NULL,
	"extensions" integer NOT NULL,
	CONSTRAINT "spend_limit_extensions_limit_id_day_pk" PRIMARY KEY("limit_id","day")
);
--> statement-breakpoint
CREATE TABLE "spend_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_sub" text NOT NULL,
	"scope" text NOT NULL,
	"agent_id" text,
	"connection_id" text,
	"unit" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spend_limits_scope_key" UNIQUE NULLS NOT DISTINCT("owner_sub","scope","agent_id","connection_id")
);
--> statement-breakpoint
ALTER TABLE "spend_limit_extensions" ADD CONSTRAINT "spend_limit_extensions_limit_id_spend_limits_id_fk" FOREIGN KEY ("limit_id") REFERENCES "public"."spend_limits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spend_limits_agent_idx" ON "spend_limits" USING btree ("agent_id");