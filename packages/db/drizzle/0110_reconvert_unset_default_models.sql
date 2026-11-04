-- The one-time default conversion saved "not set" (a chat default with no
-- model) for agents it could have given a model: Bob agents, whose models the
-- preference list names none of; Claude Code agents whose model setting named
-- a model without its provider's route prefix; and agents whose setting named
-- a model the provider does not list. The conversion now always picks a model
-- when a provider lists one, but it converts only while nothing is saved, so
-- clear the "not set" defaults saved so far: each such agent converts again on
-- its next start, schedule fire or channel turn. Only agents already on the
-- Model Router are cleared, since a saved default with no model is a normal
-- default on an older runtime.
--
-- This is the 0.2.24 copy of main's 0130_reconvert_unset_default_models. Its
-- journal `when` sits right after this branch's 0109 and before main's 0110,
-- so an install that took it still applies every migration of main on its
-- upgrade, main's 0130 included, which clears the same rows again harmlessly.
-- Do not change the `when`.
UPDATE "agents"
SET "session_pair" = NULL, "default_model_note" = NULL
WHERE "session_pair" IS NOT NULL
  AND "session_pair" ->> 'model' IS NULL
  AND "runtime_capabilities" ->> 'modelRouter' = 'true';
