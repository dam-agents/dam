CREATE TYPE "public"."activity_outcome" AS ENUM ('success', 'failure');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"actor_sub" text,
	"agent_id" text,
	"surface" text,
	"outcome" "activity_outcome" NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_events_type_occurred_idx" ON "activity_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_actor_occurred_idx" ON "activity_events" USING btree ("actor_sub","occurred_at") WHERE "actor_sub" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_events_surface_occurred_idx" ON "activity_events" USING btree ("surface","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_auth_dedup_idx" ON "activity_events" USING btree ("actor_sub","surface",date_trunc('day', "occurred_at" AT TIME ZONE 'UTC')) WHERE "type" = 'auth';--> statement-breakpoint
CREATE TABLE "actor_roles" (
	"actor_sub" text PRIMARY KEY NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_sub");
