import type { TriggerEventPayload } from "agent-runtime-api";
import type { TriggerSessionDriver } from "../../acp/index.js";
import type { TriggerStateStore } from "../infrastructure/trigger-state-store.js";

/**
 * Local trigger handler (ADR-052). Per-event dispatch runs entirely
 * inside the agent-runtime — no callback to the api-server.
 *
 * Dedupe is the agent's per-event cursor (managed in `event-loop.ts`):
 * events whose `version` is at or below the cursor are skipped before
 * this handler is called. The handler itself is therefore not
 * responsible for dedupe — only for binding `scheduleId → sessionId`
 * across continuous-mode ticks.
 *
 * For continuous mode, the prior session is resumed via the
 * `TriggerSessionDriver`. For fresh mode a new session is created.
 * Either way the prompt is queued fire-and-forget; the agent process
 * continues running it after this handler returns.
 */
export interface TriggerImpl {
  handle(payload: TriggerEventPayload): Promise<void>;
}

export function createTriggerImpl(deps: {
  driver: TriggerSessionDriver;
  stateStore: TriggerStateStore;
}): TriggerImpl {
  return {
    async handle(payload) {
      const mode = payload.sessionMode ?? "fresh";

      if (mode === "continuous") {
        const prior = deps.stateStore.getSessionForSchedule(payload.scheduleId);
        if (prior) {
          await deps.driver.start({
            task: payload.task,
            mcpServers: payload.mcpServers,
            resumeSessionId: prior,
          });
          return;
        }
        const res = await deps.driver.start({
          task: payload.task,
          mcpServers: payload.mcpServers,
        });
        deps.stateStore.setSessionForSchedule(
          payload.scheduleId,
          res.sessionId,
        );
        return;
      }

      await deps.driver.start({
        task: payload.task,
        mcpServers: payload.mcpServers,
      });
    },
  };
}
