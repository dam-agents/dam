CREATE TABLE "environment_access_lists" (
	"owning_agent_id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"emails" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
