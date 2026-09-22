CREATE TABLE "satellite_grants" (
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"agent_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "satellite_grants_owner_name_agent_id_pk" PRIMARY KEY("owner","name","agent_id")
);
--> statement-breakpoint
CREATE TABLE "satellite_jobs" (
	"owner" text NOT NULL,
	"satellite" text NOT NULL,
	"sequence" integer NOT NULL,
	"agent_id" text NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"status" text NOT NULL,
	"is_error" boolean DEFAULT false NOT NULL,
	"exit_code" integer,
	"output" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"reason" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"cancel_sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"woke_at" timestamp with time zone,
	"awaited_until" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "satellite_jobs_owner_satellite_sequence_pk" PRIMARY KEY("owner","satellite","sequence")
);
--> statement-breakpoint
CREATE TABLE "satellites" (
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"host" text,
	"max_concurrent" integer NOT NULL,
	"tools" jsonb NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"draining" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "satellites_owner_name_pk" PRIMARY KEY("owner","name")
);
--> statement-breakpoint
CREATE INDEX "satellite_grants_agent_idx" ON "satellite_grants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "satellite_jobs_dispatch_idx" ON "satellite_jobs" USING btree ("owner","satellite","status");--> statement-breakpoint
CREATE INDEX "satellite_jobs_agent_idx" ON "satellite_jobs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "satellite_jobs_lease_idx" ON "satellite_jobs" USING btree ("lease_until");