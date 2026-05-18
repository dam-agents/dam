/**
 * Reacts to InstanceDeleted — cleans up K8s PVCs and channel Secrets for the
 * deleted instance.
 */
import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type InstanceDeleted,
} from "../../../events.js";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import { LABEL_INSTANCE_REF } from "../../agents/infrastructure/labels.js";
import type { ChannelSecretStore } from "../../channels/infrastructure/channel-secret-store.js";

export function startK8sCleanupSaga(
  k8s: K8sClient,
  channelSecretStore: ChannelSecretStore,
): Subscription {
  return events$()
    .pipe(
      ofType<InstanceDeleted>(EventType.InstanceDeleted),
      mergeMap(async (event) => {
        try {
          const pvcs = await k8s.listPVCs(
            `${LABEL_INSTANCE_REF}=${event.instanceId}`,
          );
          await Promise.all(
            pvcs.map((pvc) => k8s.deletePVC(pvc.metadata!.name!)),
          );
        } catch (err) {
          process.stderr.write(
            `[k8s-cleanup] PVC cleanup failed for ${event.instanceId}: ${err}\n`,
          );
        }
        try {
          await channelSecretStore.deleteAllForInstance(event.instanceId);
        } catch (err) {
          process.stderr.write(
            `[k8s-cleanup] Channel secret cleanup failed for ${event.instanceId}: ${err}\n`,
          );
        }
      }),
    )
    .subscribe();
}
