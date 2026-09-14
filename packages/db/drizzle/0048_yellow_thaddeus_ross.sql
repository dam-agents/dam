-- #2887: One thing an Interactive Artifact asked its agent to do -- a button
-- clicked, a choice made in a dropdown, a form submitted. `action` names what
-- was asked; `payload` carries its arguments. Serving one is a full agent turn,
-- so the row is the record of it: numbered per artifact (`seq`), answered once
-- (`result`), or failed with a named reason.
-- `agent_id` is the agent the page asks; it is copied at create so a later
-- edit to the artifact cannot redirect a request.
-- Two invariants live in the indexes rather than in service code, because a
-- second replica must obey them too:
--   * `artifact_requests_in_flight_unique_idx` -- at most one unsettled request
--     per artifact. A page that asks twice over gets `busy`, never a queue.
--   * `artifact_requests_artifact_seq_unique_idx` -- `seq` is dense per
--     artifact, so two requests can never share a number.
-- `artifact_requests_artifact_created_idx` serves the rolling-hour count that
-- caps how often one artifact may ask.
-- Rows cascade with their artifact: deleting the page deletes its requests.
--
-- `library_artifacts.session_id` is where an interactive page asks: the
-- conversation it was first asked from, written once and never rewritten, so a
-- page that was answered in one chat cannot later start driving another. Null
-- means no ask has yet carried a conversation, and an ask on such a page that
-- offers none is refused -- there is no other place a page can live.
CREATE TABLE "artifact_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"artifact_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"seq" integer NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "artifact_requests" ADD CONSTRAINT "artifact_requests_artifact_id_library_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."library_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_requests_artifact_created_idx" ON "artifact_requests" USING btree ("artifact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_requests_artifact_seq_unique_idx" ON "artifact_requests" USING btree ("artifact_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_requests_in_flight_unique_idx" ON "artifact_requests" USING btree ("artifact_id") WHERE "artifact_requests"."state" in ('pending', 'delivered');