-- Opt-in prompt buttons must remain private; existing artifacts stay noninteractive.
ALTER TABLE "library_artifacts" ADD COLUMN "interactive" boolean DEFAULT false NOT NULL;
