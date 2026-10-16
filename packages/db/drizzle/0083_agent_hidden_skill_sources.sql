-- Skill sources the owner hid on one agent's skills page, keyed by repository
-- and path ("" for none) so one hide covers every kind of source with that identity.
CREATE TABLE "agent_hidden_skill_sources" (
	"agent_id" text NOT NULL,
	"git_url" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_hidden_skill_sources_agent_id_git_url_path_pk" PRIMARY KEY("agent_id","git_url","path")
);
