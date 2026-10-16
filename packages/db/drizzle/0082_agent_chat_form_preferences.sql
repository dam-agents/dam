-- Chat form preferences: how an agent may use forms in the owner's web chat.
-- The api-server reads them for the capability announcement in briefings and
-- for check_chat_form, so they live here and not in the browser.
CREATE TABLE "agent_chat_form_preferences" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"preferences" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
