-- Usage shows how many calls of a rollup row still wait for a price, so the
-- rollup counts them beside its estimates. The calls that wait now are the
-- call rows whose price source is awaiting, counted into the rollup row each
-- one was added to.
ALTER TABLE "spend_daily" ADD COLUMN "awaiting_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "spend_daily" d
SET "awaiting_calls" = w."calls"
FROM (
  SELECT (c."started_at" AT TIME ZONE 'UTC')::date AS "day",
    c."payer_agent_id", c."connection_id", c."model", c."session_id",
    c."calling_agent_id", count(*)::int AS "calls"
  FROM "spend_calls" c
  WHERE c."price_source" = 'awaiting'
  GROUP BY 1, 2, 3, 4, 5, 6
) w
WHERE d."day" = w."day"
  AND d."payer_agent_id" = w."payer_agent_id"
  AND d."connection_id" = w."connection_id"
  AND d."model" = w."model"
  AND d."session_id" = w."session_id"
  AND d."calling_agent_id" = w."calling_agent_id";
