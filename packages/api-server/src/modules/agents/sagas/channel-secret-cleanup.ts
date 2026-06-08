/**
 * Reacts to AgentDeleted — deletes the agent's per-channel credential Secrets.
 * PVCs are the controller's job (ADR-058), not the api-server's.
 */
import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentDeleted,
} from "../../../events.js";
import type { ChannelSecretStore } from "../../channels/infrastructure/channel-secret-store.js";

export function startChannelSecretCleanupSaga(
  channelSecretStore: ChannelSecretStore,
): Subscription {
  return events$()
    .pipe(
      ofType<AgentDeleted>(EventType.AgentDeleted),
      mergeMap(async (event) => {
        try {
          await channelSecretStore.deleteAllForAgent(event.agentId);
        } catch (err) {
          process.stderr.write(
            `[channel-secret-cleanup] failed for ${event.agentId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
