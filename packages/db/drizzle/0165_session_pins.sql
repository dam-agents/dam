-- The Sessions each user pinned in the sidebar. A pin is only the pair of
-- Agent and Session and never decides that the Session exists. Its rows go
-- with their Agent (the cleanup list) and their Session (the session watcher),
-- and attention retention keeps the record row of a pinned Session, so a pin
-- stays readable however long its Session is quiet.
CREATE TABLE "session_pins" (
	"owner" text NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_pins_owner_agent_id_session_id_pk" PRIMARY KEY("owner","agent_id","session_id")
);
--> statement-breakpoint
CREATE INDEX "session_pins_agent_idx" ON "session_pins" USING btree ("agent_id","session_id");