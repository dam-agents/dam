-- Nothing seeds a profile any more, so its marker table and column go.
-- profile_defaults becomes the owner's default for new agents: a profile or
-- values of their own; deleting that profile removes the row, and new agents
-- start on the base default.
ALTER TABLE "profile_seeds" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "profile_seeds" CASCADE;--> statement-breakpoint
ALTER TABLE "profile_defaults" DROP CONSTRAINT "profile_defaults_profile_id_profiles_id_fk";
--> statement-breakpoint
DROP INDEX "profiles_owner_seed_idx";--> statement-breakpoint
ALTER TABLE "profile_defaults" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_defaults" ADD COLUMN "session_pair" jsonb;--> statement-breakpoint
ALTER TABLE "profile_defaults" ADD CONSTRAINT "profile_defaults_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "seed";--> statement-breakpoint
ALTER TABLE "profile_defaults" ADD CONSTRAINT "profile_defaults_profile_xor_pair" CHECK (("profile_defaults"."profile_id" is null) <> ("profile_defaults"."session_pair" is null));