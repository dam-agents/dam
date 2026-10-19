-- The preset source of a trusted-preset row a Connection took over, so the
-- row goes back to the preset when the Connection is revoked instead of
-- being revoked with it.
ALTER TABLE "egress_rules" ADD COLUMN "preset_source" text;
