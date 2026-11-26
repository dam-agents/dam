DROP INDEX "owner_request_cards_open_idx";--> statement-breakpoint
ALTER TABLE "owner_request_cards" ADD COLUMN "sealed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "pending_approvals_route_status_idx" ON "pending_approvals" USING btree ("owner_route","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_request_cards_open_idx" ON "owner_request_cards" USING btree ("owner_sub","agent_id","team_id","kind") WHERE closed_at IS NULL AND sealed_at IS NULL AND kind IN ('turn', 'background');