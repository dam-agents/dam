/**
 * Reacts to AgentDeleted — deletes per-agent Skills application state
 * (installed-skill rows + publish records) from Postgres. Mirrors the
 * channel-cleanup saga.
 *
 * `Skill Source` and `Skill Set` rows are owner-scoped, not agent-scoped, so
 * they are untouched by agent deletion — a set outlives every sandbox it was
 * ever applied to, which is the whole point of saving one.
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
