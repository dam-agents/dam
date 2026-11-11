ALTER TABLE "api_key_revocations" ADD COLUMN "connection_id" text;--> statement-breakpoint
CREATE INDEX "api_key_revocations_connection_idx" ON "api_key_revocations" USING btree ("connection_id");