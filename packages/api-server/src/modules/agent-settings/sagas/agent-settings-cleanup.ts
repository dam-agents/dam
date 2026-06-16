/**
 * Reacts to AgentDeleted — deletes the agent's harness-config row from
 * Postgres. Mirrors the skills-cleanup saga.
 */
import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentDeleted,
} from "../../../events.js";

export function startAgentSettingsCleanupSaga(
  deleteAgentSettings: (agentId: string) => Promise<void>,
): Subscription {
  return events$()
    .pipe(
      ofType<AgentDeleted>(EventType.AgentDeleted),
      mergeMap(async (event) => {
        try {
          await deleteAgentSettings(event.agentId);
        } catch (err) {
          process.stderr.write(
            `[agent-settings-cleanup] failed for ${event.agentId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
