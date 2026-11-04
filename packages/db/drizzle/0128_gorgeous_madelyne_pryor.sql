-- A profile names the platform sub-agent it uses too (D193B), so a slot
-- following the profile runs on it while its own sub-agent slot is empty.
ALTER TABLE "profiles" ADD COLUMN "subagent_provider_template" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "subagent_model" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_subagent_xor_template" CHECK (("profiles"."subagent_provider_template" is null) = ("profiles"."subagent_model" is null));