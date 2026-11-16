-- An interactive page can pick what the Sessions its prompts open run on, as a
-- Slack channel can: a profile or values of its own in the chat default's two
-- slots. All four null keeps the agent's channel pair, as before.
ALTER TABLE "library_artifacts" ADD COLUMN "prompt_profile_id" text;--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD COLUMN "prompt_session_pair" jsonb;--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD COLUMN "prompt_subagent_profile" text;--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD COLUMN "prompt_subagent_settings" jsonb;--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD CONSTRAINT "library_artifacts_prompt_profile_id_profiles_id_fk" FOREIGN KEY ("prompt_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD CONSTRAINT "library_artifacts_prompt_subagent_profile_profiles_id_fk" FOREIGN KEY ("prompt_subagent_profile") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD CONSTRAINT "library_artifacts_prompt_pair_xor_profile" CHECK ("library_artifacts"."prompt_profile_id" is null or "library_artifacts"."prompt_session_pair" is null);--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD CONSTRAINT "library_artifacts_prompt_subagent_xor_profile" CHECK ("library_artifacts"."prompt_subagent_profile" is null or "library_artifacts"."prompt_subagent_settings" is null);