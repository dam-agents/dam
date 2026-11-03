-- A file transfer is authorised by the claim that is running the Job, not by a
-- Job that merely happens to be running. The token is minted per claim and
-- stored as a hash; consuming it is one conditional UPDATE, which is what makes
-- "still running" and "not yet transferred" hold at the same instant.
ALTER TABLE "satellite_jobs" ADD COLUMN "transfer_token_hash" text;
