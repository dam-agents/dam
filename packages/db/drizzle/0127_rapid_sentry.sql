-- A file transfer is authorised by the claim that is running the Job, not by a
-- Job that merely happens to be running, and it may move a file only the way the
-- Agent's call asked for: the direction is frozen here at admission, from the
-- Snapshot that accepted the call, so a manifest registered later cannot turn a
-- granted download into an upload. The token is minted per claim and stored as a
-- hash; consuming it is one conditional UPDATE, which is what makes "still
-- running" and "not yet transferred" hold at the same instant.
ALTER TABLE "satellite_jobs" ADD COLUMN "transfer_token_hash" text;--> statement-breakpoint
ALTER TABLE "satellite_jobs" ADD COLUMN "transfer_direction" text;
