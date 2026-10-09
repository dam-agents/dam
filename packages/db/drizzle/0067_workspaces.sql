-- Workspaces: a shared owner for agents and their connections, schedules and
-- budget. Members are stored by login email, so an admin can add a person
-- before that person ever signs in. The role maps to the existing API scopes.

CREATE TYPE "public"."workspace_role" AS ENUM('admin', 'editor', 'reader');--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "workspace_role" NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_email_pk" PRIMARY KEY("workspace_id","email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_members_email_idx" ON "workspace_members" USING btree ("email");