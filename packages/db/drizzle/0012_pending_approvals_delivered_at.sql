ALTER TABLE "pending_approvals" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "pending_approvals_undelivered_idx" ON "pending_approvals" USING btree ("resolved_at") WHERE status = 'resolved' AND delivered_at IS NULL;
