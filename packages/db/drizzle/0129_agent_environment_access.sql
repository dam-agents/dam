-- Agents open Environments as themselves (#6198). An owner or an Agent's
-- editors name Agents, of any owner, by id beside the people who may open an
-- Environment: on the Agent's page for all its Environments, or in one
-- Environment's Share dialog. Agent rows sit in tables of their own, so an
-- email never matches an Agent and the people's rows stay as they are. Each
-- Agent's key is kept as a hash only, and the gate stamps when an Agent last
-- opened an Environment, at most once a minute, for its owner to see.
CREATE TABLE "agent_environment_agent_members" (
	"owning_agent_id" text NOT NULL,
	"member_agent_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_environment_agent_members_owning_agent_id_member_agent_id_pk" PRIMARY KEY("owning_agent_id","member_agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_keys" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"owner_sub" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_agent_members" (
	"environment_id" text NOT NULL,
	"member_agent_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_agent_members_environment_id_member_agent_id_pk" PRIMARY KEY("environment_id","member_agent_id")
);
--> statement-breakpoint
CREATE TABLE "environment_agent_visits" (
	"environment_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"last_opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "environment_agent_visits_environment_id_agent_id_pk" PRIMARY KEY("environment_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "environment_agent_members" ADD CONSTRAINT "environment_agent_members_environment_id_environments_agent_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_agent_visits" ADD CONSTRAINT "environment_agent_visits_environment_id_environments_agent_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_environment_agent_members_member_idx" ON "agent_environment_agent_members" USING btree ("member_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_hash_idx" ON "agent_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "environment_agent_members_member_idx" ON "environment_agent_members" USING btree ("member_agent_id");--> statement-breakpoint
CREATE INDEX "environment_agent_visits_agent_idx" ON "environment_agent_visits" USING btree ("agent_id");