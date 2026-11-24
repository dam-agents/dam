ALTER TABLE "spend_calls" ADD COLUMN "price_source" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "price_model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_calls" ADD COLUMN "estimate_reasons" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "spend_calls_awaiting_price_idx" ON "spend_calls" USING btree ("price_source","price_model") WHERE "spend_calls"."price_source" = 'awaiting';