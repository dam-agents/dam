/**
 * Reacts to AgentDeleted — deletes per-instance Skills application state
 * (installed-skill rows + publish records) from Postgres. Mirrors the
 * channel-cleanup saga.
 *
 * `Skill Source` rows are owner-scoped, not instance-scoped, so they are
 * untouched by instance deletion.
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
  deleteInstanceSkills: (agentId: string) => Promise<void>,
): Subscription {
  return events$()
    .pipe(
      ofType<AgentDeleted>(EventType.AgentDeleted),
      mergeMap(async (event) => {
        try {
          await deleteInstanceSkills(event.agentId);
        } catch (err) {
          process.stderr.write(
            `[skills-cleanup] failed for ${event.agentId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
