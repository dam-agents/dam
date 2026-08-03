DROP INDEX "channels_agent_type_idx";--> statement-breakpoint
CREATE INDEX "channels_agent_type_idx" ON "channels" USING btree ("agent_id","type");