import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentCreated,
} from "../../../events.js";
import type { AgentRegistryRow } from "../domain/types.js";

export type PersistAgentsDeps = {
  upsertAgent: (row: AgentRegistryRow) => Promise<void>;
};

const STREAM_CONCURRENCY = 8;

export function startPersistAgentsSaga(deps: PersistAgentsDeps): Subscription {
  const sub = new Subscription();

  sub.add(
    events$()
      .pipe(
        ofType<AgentCreated>(EventType.AgentCreated),
        mergeMap(async (event) => {
          try {
            await deps.upsertAgent({
              id: event.agentId,
              ownerSub: event.ownerSub,
            });
          } catch (err) {
            process.stderr.write(`[agents/persist] upsert failed: ${err}\n`);
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  return sub;
}
