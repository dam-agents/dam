-- A sub-agent's deadline now runs from the first delivery of its task, not from
-- its spawn, so a start that waits for room in its owner's memory keeps its whole
-- time limit. A row spawned before this change whose target has said hello had
-- its task delivered and its deadline set from the spawn, so it counts as
-- started then; an ended row too. A row still waiting for room is left unstarted,
-- and its first delivery stamps it.
ALTER TABLE "invocations" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
UPDATE "invocations" SET "started_at" = "created_at"
WHERE "status" <> 'running'
   OR "id" IN (SELECT "id" FROM "agents" WHERE "runtime_last_hello_at" IS NOT NULL);
