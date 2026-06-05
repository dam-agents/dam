CREATE TABLE "agent_workspace" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
