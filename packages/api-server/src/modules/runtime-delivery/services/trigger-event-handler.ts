import { eq, type Db, triggerDispatches } from "db";
import type {
  FireTriggerInput,
  FireTriggerResult,
  TriggerEventHandler,
} from "api-server-api";

/**
 * Per-kind work handler for `trigger` events (ADR-052, ADR-053). Starts a
 * session for the schedule's task. Idempotent on `event_id` — a redelivered
 * event hits the unique constraint on `trigger_dispatches.event_id` and
 * returns the existing session row without re-firing.
 *
 * Does NOT touch `runtime_events.dispatched_at` — the worker owns that
 * stamp on apply-ack.
 *
 * The actual session-start work is delegated to a port (the existing ACP
 * trigger path lives in api-server's harness app). The handler's only
 * responsibilities are the side-effect-table write and dedupe-on-id.
 */
export interface StartTriggerSessionPort {
  start(input: {
    agentId: string;
    scheduleId: string;
    task: string;
    sessionMode: "continuous" | "fresh";
    mcpServers: unknown[];
  }): Promise<{ sessionId: string; stopReason?: string }>;
}

export function createTriggerEventHandler(deps: {
  db: Db;
  startSession: StartTriggerSessionPort;
}): TriggerEventHandler {
  return {
    async fire(agentId, input: FireTriggerInput): Promise<FireTriggerResult> {
      // Look up — if we've already fired this event, return the recorded
      // session. The state-builder will exclude this event id from the
      // next snapshot once the worker stamps the cursor.
      const existing = await deps.db
        .select()
        .from(triggerDispatches)
        .where(eq(triggerDispatches.eventId, input.id));
      if (existing.length > 0) {
        return { sessionId: existing[0]!.sessionId };
      }

      const sessionMode = input.payload.sessionMode ?? "fresh";
      const mcpServers = input.payload.mcpServers ?? [];
      const result = await deps.startSession.start({
        agentId,
        scheduleId: input.payload.scheduleId,
        task: input.payload.task,
        sessionMode,
        mcpServers,
      });

      // Record the dispatch. The unique constraint on event_id catches
      // crash-during-fire: a redelivered event finds the existing row and
      // returns the same session.
      try {
        await deps.db.insert(triggerDispatches).values({
          eventId: input.id,
          agentId,
          scheduleId: input.payload.scheduleId,
          sessionId: result.sessionId,
        });
      } catch (err) {
        // Concurrent fire of the same event id (two replicas processed the
        // same hello-delivered event). Re-read and return the winner's
        // session.
        const winner = await deps.db
          .select()
          .from(triggerDispatches)
          .where(eq(triggerDispatches.eventId, input.id));
        if (winner.length > 0) {
          return { sessionId: winner[0]!.sessionId };
        }
        throw err;
      }

      return { sessionId: result.sessionId, stopReason: result.stopReason };
    },
  };
}
