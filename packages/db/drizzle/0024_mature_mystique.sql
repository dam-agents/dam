-- Hosted Harness (ADR-084): hosted sessions, turns, and the append-only Turn Event Log.
-- (turn_id, seq) unique index is the replica fence; events are never rewritten.
CREATE TABLE "hosted_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"owner" text NOT NULL,
	"title" text,
	"mode" text DEFAULT 'chat' NOT NULL,
	"schedule_id" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_turn_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hosted_turn_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hosted_sessions_agent_idx" ON "hosted_sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_turn_events_fence_idx" ON "hosted_turn_events" USING btree ("turn_id","seq");--> statement-breakpoint
CREATE INDEX "hosted_turn_events_session_idx" ON "hosted_turn_events" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "hosted_turns_session_idx" ON "hosted_turns" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "hosted_turns_running_idx" ON "hosted_turns" USING btree ("updated_at") WHERE "hosted_turns"."status" = 'running';