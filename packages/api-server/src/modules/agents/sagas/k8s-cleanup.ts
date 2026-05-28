/**
 * Reacts to AgentDeleted — cleans up K8s PVCs and channel Secrets for the
 * deleted agent.
 */
import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentDeleted,
} from "../../../events.js";
import type { K8sClient } from "../infrastructure/k8s.js";
import { LABEL_AGENT_REF } from "../infrastructure/labels.js";
import type { ChannelSecretStore } from "../../channels/infrastructure/channel-secret-store.js";

export function startK8sCleanupSaga(
  k8s: K8sClient,
  channelSecretStore: ChannelSecretStore,
): Subscription {
  return events$()
    .pipe(
      ofType<AgentDeleted>(EventType.AgentDeleted),
      mergeMap(async (event) => {
        try {
          const pvcs = await k8s.listPVCs(
            `${LABEL_AGENT_REF}=${event.agentId}`,
          );
          await Promise.all(
            pvcs.map((pvc) => k8s.deletePVC(pvc.metadata!.name!)),
          );
        } catch (err) {
          process.stderr.write(
            `[k8s-cleanup] PVC cleanup failed for ${event.agentId}: ${err}\n`,
          );
        }
        try {
          await channelSecretStore.deleteAllForAgent(event.agentId);
        } catch (err) {
          process.stderr.write(
            `[k8s-cleanup] Channel secret cleanup failed for ${event.agentId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
