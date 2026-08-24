import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentDeleted,
} from "../../../events.js";

export function startKbSharesCleanupSaga(
  cleanupAgentShare: (agentId: string) => Promise<void>,
): Subscription {
  return events$()
    .pipe(
      ofType<AgentDeleted>(EventType.AgentDeleted),
      mergeMap(async (event) => {
        try {
          await cleanupAgentShare(event.agentId);
        } catch (err) {
          process.stderr.write(
            `[kb-shares-cleanup] cleanup failed for ${event.agentId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
