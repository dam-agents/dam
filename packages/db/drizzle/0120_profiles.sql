-- Profiles: a named, owner-scoped preset of one session choice (harness,
-- provider template, model and its session settings), which agent defaults, a
-- channel's turns and a schedule point at instead of storing a copy, and each
-- owner's one default for new agents.
-- Additive: the agent, channel and Telegram columns are nullable, so every
-- existing row keeps running on the pair it already holds.
-- The XOR checks state the invariant every reader relies on: each slot of a
-- chat default, the primary model and the platform subagent, is a profile
-- reference or values of its own, never both. The restrictive foreign keys
-- make deleting a referenced profile, or an owner's default, impossible rather
-- than a check-then-act race.
CREATE TABLE "profile_defaults" (
	"owner" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "agents" ADD COLUMN "platform_subagent_settings" jsonb;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "profile_defaults" ADD CONSTRAINT "profile_defaults_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_owner_name_idx" ON "profiles" USING btree ("owner","name");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_owner_seed_idx" ON "profiles" USING btree ("owner","seed") WHERE "profiles"."seed" is not null;--> statement-breakpoint
CREATE INDEX "profiles_owner_idx" ON "profiles" USING btree ("owner");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_session_profile_profiles_id_fk" FOREIGN KEY ("session_profile") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_platform_subagent_profile_profiles_id_fk" FOREIGN KEY ("platform_subagent_profile") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD CONSTRAINT "telegram_conversations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_session_pair_xor_profile" CHECK ("agents"."session_profile" is null or "agents"."session_pair" is null);--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_platform_subagent_xor_profile" CHECK ("agents"."platform_subagent_profile" is null or "agents"."platform_subagent_settings" is null);