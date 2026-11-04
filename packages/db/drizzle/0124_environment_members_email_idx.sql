-- Find each list by the person on it, as agent_editors does, for a view of
-- the Environments shared with someone.
CREATE INDEX "agent_environment_members_email_idx" ON "agent_environment_members" USING btree ("email");--> statement-breakpoint
CREATE INDEX "environment_members_email_idx" ON "environment_members" USING btree ("email");