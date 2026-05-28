/**
 * Reacts to AgentDeleted — deletes per-agent Skills application state
 * (installed-skill rows + publish records) from Postgres. Mirrors the
 * channel-cleanup saga.
 *
 * `Skill Source` rows are owner-scoped, not agent-scoped, so they are
 * untouched by agent deletion.
 */
import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentDeleted,
} from "../../../events.js";

export function startSkillsCleanupSaga(
  deleteAgentSkills: (agentId: string) => Promise<void>,
): Subscription {
  return events$()
    .pipe(
      ofType<AgentDeleted>(EventType.AgentDeleted),
      mergeMap(async (event) => {
        try {
          await deleteAgentSkills(event.agentId);
        } catch (err) {
          process.stderr.write(
            `[skills-cleanup] failed for ${event.agentId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
