-- Profiles: a named, owner-scoped preset of one session choice (harness,
-- provider template, model and its session settings), which agent defaults, a
-- channel's turns and a schedule point at instead of storing a copy.
-- Additive and referenced by nothing yet: the agent and channel columns are
-- nullable, so every existing row keeps running on the pair it already holds.
-- The XOR check states the one invariant every reader relies on — a chat
-- default is a profile reference or an inline pair, never both — and the
-- restrictive foreign keys make a delete of a referenced profile impossible
-- rather than a check-then-act race.
CREATE TABLE "profile_seeds" (
	"owner" text PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"seed" text,
	"harness" text NOT NULL,
	"provider_template" text NOT NULL,
	"model" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "session_profile" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "platform_subagent_profile" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "profile_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_owner_name_idx" ON "profiles" USING btree ("owner","name");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_owner_seed_idx" ON "profiles" USING btree ("owner","seed") WHERE "profiles"."seed" is not null;--> statement-breakpoint
CREATE INDEX "profiles_owner_idx" ON "profiles" USING btree ("owner");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_session_profile_profiles_id_fk" FOREIGN KEY ("session_profile") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_platform_subagent_profile_profiles_id_fk" FOREIGN KEY ("platform_subagent_profile") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_session_pair_xor_profile" CHECK ("agents"."session_profile" is null or "agents"."session_pair" is null);