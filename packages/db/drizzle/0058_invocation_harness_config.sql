-- An Invocation can now ask for its target's harness config (model, mode,
-- config options). The row keeps what was asked, so the platform can fail the
-- Invocation once the target registers unable to apply it,
-- instead of accepting a result from the target's default model.
ALTER TABLE "invocations" ADD COLUMN "harness_config" jsonb;