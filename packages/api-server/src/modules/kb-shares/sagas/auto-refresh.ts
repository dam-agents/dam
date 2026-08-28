import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentWoken,
} from "../../../events.js";
import type { KbShareRow } from "../domain/types.js";

export interface KbShareSyncSagaDeps {
  listDirtyActive: () => Promise<KbShareRow[]>;
  attemptSync: (agentId: string) => Promise<void>;
}

export interface KbShareSyncSaga {
  unsubscribe(): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the pod's flusher owns change detection and
 * debounce; this saga only re-delivers share config to a pod at the moments
 * the server learns one came up (wake, api-server boot), flushing immediately
 * when the row carries a server-side dirty flag (index self-heal). It never
 * wakes a pod and swallows unreachable or old runtimes — the flusher's
 * PVC-persisted state makes delivery best-effort, not load-bearing.
 */
export function startKbShareSyncSaga(deps: KbShareSyncSagaDeps): KbShareSyncSaga {
  const subscription: Subscription = events$()
    .pipe(
      ofType<AgentWoken>(EventType.AgentWoken),
      mergeMap((event) => deps.attemptSync(event.agentId)),
    )
    .subscribe();

  void (async () => {
    try {
      for (const row of await deps.listDirtyActive()) {
        await deps.attemptSync(row.agentId);
      }
    } catch (err) {
      process.stderr.write(
        `[kb-share-sync] dirty-share startup sweep failed: ${err}\n`,
      );
    }
  })();

  return {
    unsubscribe() {
      subscription.unsubscribe();
    },
  };
}
