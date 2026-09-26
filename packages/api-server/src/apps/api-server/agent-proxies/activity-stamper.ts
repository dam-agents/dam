import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import { LAST_ACTIVITY_KEY } from "../../../modules/agents/infrastructure/labels.js";
import { boundedSet } from "../../../core/bounded-map.js";

const ACTIVITY_DEBOUNCE_MS = 30_000;

export interface ActivityStamper {
  isDue(agentId: string): boolean;
  stamp(agentId: string): void;
  bump(agentId: string): void;
}

export function createActivityStamper(
  repo: Pick<AgentsRepository, "patchAnnotation">,
): ActivityStamper {
  const lastStamped = new Map<string, number>();
  const isDue = (agentId: string) =>
    Date.now() - (lastStamped.get(agentId) ?? 0) >= ACTIVITY_DEBOUNCE_MS;
  const stamp = (agentId: string) => {
    boundedSet(lastStamped, agentId, Date.now());
    repo
      .patchAnnotation(agentId, LAST_ACTIVITY_KEY, new Date().toISOString())
      .catch(() => {});
  };
  return {
    isDue,
    stamp,
    bump(agentId) {
      if (isDue(agentId)) stamp(agentId);
    },
  };
}
