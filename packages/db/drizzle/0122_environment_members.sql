-- Who may open an Environment, as rows, one per person, like an Agent's
-- editors and an artifact's viewers. The Agent Environment Members of an Agent
-- open every Environment it creates, and are read live at each request. The
-- Environment Members of one Environment add people to that one only, and go
-- with it. Only people set either list; the agent no longer narrows one.
CREATE TABLE "agent_environment_members" (
	"owning_agent_id" text NOT NULL,
	"email" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_environment_members_owning_agent_id_email_pk" PRIMARY KEY("owning_agent_id","email")
);
--> statement-breakpoint
CREATE TABLE "environment_members" (
	"environment_id" text NOT NULL,
	"email" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_members_environment_id_email_pk" PRIMARY KEY("environment_id","email")
);
--> statement-breakpoint
ALTER TABLE "environment_members" ADD CONSTRAINT "environment_members_environment_id_environments_agent_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("agent_id") ON DELETE cascade ON UPDATE no action;