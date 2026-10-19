-- One row per metered call: who made it, in which Session, when it started,
-- and what it cost once settled. The chat's turn line sums the calls that
-- start inside a turn; the daily rollup stays the source of every total and
-- limit. Rows older than 30 days are deleted by a periodic job.
CREATE TABLE "spend_calls" (
	"calling_agent_id" text NOT NULL,
	"call_id" text NOT NULL,
	"owner_sub" text NOT NULL,
	"payer_agent_id" text NOT NULL,
	"session_id" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"unit" text NOT NULL,
	"cost_micros" bigint NOT NULL,
	CONSTRAINT "spend_calls_pk" PRIMARY KEY("calling_agent_id","call_id")
);
--> statement-breakpoint
CREATE INDEX "spend_calls_session_started_idx" ON "spend_calls" USING btree ("calling_agent_id","session_id","started_at");--> statement-breakpoint
CREATE INDEX "spend_calls_started_idx" ON "spend_calls" USING btree ("started_at");