-- The daily spend rollup gets the session and the calling agent of each call
-- as keys, and the calls' model time as a counter. Rows from before this
-- migration keep empty keys: no session and an unknown calling agent. The
-- columns are added before the primary key that names them.
ALTER TABLE "spend_daily" ADD COLUMN "session_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_daily" ADD COLUMN "calling_agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_daily" ADD COLUMN "duration_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_daily" DROP CONSTRAINT "spend_daily_day_payer_agent_id_connection_id_model_pk";--> statement-breakpoint
ALTER TABLE "spend_daily" ADD CONSTRAINT "spend_daily_pk" PRIMARY KEY("day","payer_agent_id","connection_id","model","session_id","calling_agent_id");--> statement-breakpoint
CREATE INDEX "spend_daily_calling_agent_day_idx" ON "spend_daily" USING btree ("calling_agent_id","day");
