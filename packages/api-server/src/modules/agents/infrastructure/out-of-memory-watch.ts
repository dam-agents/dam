import { emit, EventType } from "../../../events.js";
import {
  isNewOutOfMemoryRestart,
  type PodRestartState,
} from "../domain/out-of-memory.js";
import { agentOwner } from "./agent-mappers.js";
import type { KubeObject } from "./k8s.js";

export type AgentObservation = "add" | "update" | "delete";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns the Agent status the controller rewrites in
 * place into one AgentOutOfMemory event per restart caused by exceeding memory.
 * The status keeps only the latest restart count and reason, and the count goes
 * back to zero on hibernation, so the event is the only record that lasts. An
 * Agent first seen on "add" (informer start or relist) sets the baseline and
 * emits nothing, so a restart of the api-server does not report old restarts
 * again. Each replica runs its own watch; the activity log keeps one row per
 * Agent and day, so duplicates from several replicas collapse there.
 */
export function createOutOfMemoryWatch(): (
  kind: AgentObservation,
  obj: KubeObject,
) => void {
  const seen = new Map<string, PodRestartState>();
  return (kind, obj) => {
    const id = obj.metadata?.name;
    if (!id) return;
    if (kind === "delete") {
      seen.delete(id);
      return;
    }
    const status = (obj.status ?? {}) as {
      agentPodRestarts?: number;
      agentPodRestartReason?: string;
    };
    const next: PodRestartState = {
      restarts:
        typeof status.agentPodRestarts === "number" ? status.agentPodRestarts : 0,
      reason: status.agentPodRestartReason || undefined,
    };
    const previous = seen.get(id);
    seen.set(id, next);
    if (kind === "add") return;
    const owner = agentOwner(obj);
    if (!owner || !isNewOutOfMemoryRestart(previous, next)) return;
    emit({
      type: EventType.AgentOutOfMemory,
      agentId: id,
      ownerSub: owner,
      restarts: next.restarts,
    });
  };
}
