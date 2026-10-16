-- The harness catalog now gives Codex a telemetry rail, delivered with every
-- Agent's runtime state. Delivery only happens when the desired version moves,
-- and a catalog change moves nothing, so an Agent that already holds its state
-- would run Codex without the rail and its Codex sessions would show no spend.
-- This bumps every Agent once; an Agent whose state comes out unchanged (no
-- telemetry backend, or no Codex in its runtime) is short-circuited by its hash.
UPDATE runtime_state_outbox
SET version = version + 1,
    last_enqueued_at = now();
