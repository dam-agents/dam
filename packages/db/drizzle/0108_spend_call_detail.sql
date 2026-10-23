-- A call row also names the Model Router's call id, which joins it to the
-- router's telemetry record, and holds the call's Connection, provider
-- template, model, counts and estimate flag, so a window in hours reads the
-- same figures as a day.
ALTER TABLE "spend_calls" ADD COLUMN "router_call_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "connection_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "provider_template" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "uncached_input_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "output_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "cache_read_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "cache_write_5m_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "cache_write_1h_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "web_searches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "duration_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "spend_calls_router_call_idx" ON "spend_calls" USING btree ("owner_sub","router_call_id");