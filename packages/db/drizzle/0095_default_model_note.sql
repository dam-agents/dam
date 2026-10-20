-- Conversion of an old default (harness-config) may run an Agent on another
-- model than its setting named (Haiku on a provider with no Haiku runs the
-- newest Sonnet); the note says so until the owner saves a default, so Home
-- can tell them.
ALTER TABLE "agents" ADD COLUMN "default_model_note" jsonb;