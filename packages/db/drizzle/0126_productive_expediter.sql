-- A Satellite name outlives the row that holds it: removing one and registering
-- the same name again restarts its Job sequence at 1, so a worker that was away
-- could otherwise claim, lease or settle the successor's Jobs. Each registration
-- of a name gets an identity of its own, and every worker mutation carries it.
ALTER TABLE "satellites" ADD COLUMN "incarnation" uuid DEFAULT gen_random_uuid() NOT NULL;
