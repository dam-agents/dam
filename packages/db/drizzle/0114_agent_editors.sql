-- The Editor List of each Agent: one row per email its owner names as an
-- Agent Editor. Emails, not user ids, because a listed person may never have
-- signed in; they are stored lowercased and match only a verified email. The
-- email index finds the Agents shared with a signed-in person.
CREATE TABLE "agent_editors" (
	"agent_id" text NOT NULL,
	"email" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_editors_agent_id_email_pk" PRIMARY KEY("agent_id","email")
);
--> statement-breakpoint
CREATE INDEX "agent_editors_email_idx" ON "agent_editors" USING btree ("email");