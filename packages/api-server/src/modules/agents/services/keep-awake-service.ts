import type { AgentSpec, AgentSpecCR } from "api-server-api";
import type { AgentsRepository } from "../infrastructure/agents-repository.js";
import { currentFromPins } from "../domain/hibernation.js";

// One workload-held keep-awake lease, as stored on the Agent CR.
export type KeepAwakePin = NonNullable<AgentSpecCR["keepAwakePins"]>[number];

// What governs `current`: the operator baseline ("manual") or the workload pins.
export type HibernationTimeoutSource = NonNullable<
  AgentSpecCR["currentHibernationTimeoutSource"]
>;

// The agent's keep-awake state as stored on the CR.
export interface KeepAwakeInfo {
  baseHibernationTimeoutMin: number | null;
  currentHibernationTimeoutMin: number | null;
  currentHibernationTimeoutSource: HibernationTimeoutSource;
  keepAwakePins: KeepAwakePin[];
}

export interface KeepAwakeService {
  // Add a lease for this agent; throws if id already exists. value 0/omitted = never.
  acquire(agentId: string, id: string, value?: number): Promise<void>;
  // Remove a lease by id; idempotent (no error if absent).
  release(agentId: string, id: string): Promise<void>;
  // Drop all leases; current reverts to the baseline.
  purge(agentId: string): Promise<void>;
  // Read the keep-awake state straight off the CR.
  info(agentId: string): Promise<KeepAwakeInfo>;
}

export function createKeepAwakeService(
  repo: AgentsRepository,
): KeepAwakeService {
  // Every write derives current/source from the live pins → optimistic-concurrency RMW.
  async function mutate(
    agentId: string,
    fn: (spec: AgentSpec) => Record<string, unknown>,
  ): Promise<void> {
    const updated = await repo.mutateSpec(agentId, undefined, fn);
    if (!updated) throw new Error(`agent ${agentId} not found`);
  }

  return {
    async acquire(agentId, id, value) {
      await mutate(agentId, (spec) => {
        const pins = spec.keepAwakePins ?? [];
        if (pins.some((p) => p.id === id)) {
          throw new Error(`keep-awake pin "${id}" already exists`);
        }
        const pin: KeepAwakePin = {
          id,
          ...(value !== undefined ? { value } : {}),
          createdAt: new Date().toISOString(),
        };
        const next = [...pins, pin];
        return {
          keepAwakePins: next,
          currentHibernationTimeoutMin: currentFromPins(
            next,
            spec.baseHibernationTimeoutMin ?? null,
          ),
          currentHibernationTimeoutSource: "pins",
        };
      });
    },

    async release(agentId, id) {
      await mutate(agentId, (spec) => {
        const pins = spec.keepAwakePins ?? [];
        const remaining = pins.filter((p) => p.id !== id);
        const baseline = spec.baseHibernationTimeoutMin ?? null;
        const source = spec.currentHibernationTimeoutSource ?? "manual";
        if (remaining.length === 0) {
          // No pins left → governance returns to the manual baseline.
          return {
            keepAwakePins: remaining,
            currentHibernationTimeoutMin: baseline,
            currentHibernationTimeoutSource: "manual",
          };
        }
        if (source === "pins") {
          // Pins still govern → recompute current from what remains.
          return {
            keepAwakePins: remaining,
            currentHibernationTimeoutMin: currentFromPins(remaining, baseline),
          };
        }
        // Manual governs → drop the pin but leave current untouched.
        return { keepAwakePins: remaining };
      });
    },

    async purge(agentId) {
      await mutate(agentId, (spec) => ({
        keepAwakePins: [],
        currentHibernationTimeoutMin: spec.baseHibernationTimeoutMin ?? null,
        currentHibernationTimeoutSource: "manual",
      }));
    },

    async info(agentId) {
      const agent = await repo.get(agentId);
      if (!agent) throw new Error(`agent ${agentId} not found`);
      const { spec } = agent;
      return {
        baseHibernationTimeoutMin: spec.baseHibernationTimeoutMin ?? null,
        currentHibernationTimeoutMin: spec.currentHibernationTimeoutMin ?? null,
        currentHibernationTimeoutSource:
          spec.currentHibernationTimeoutSource ?? "manual",
        keepAwakePins: spec.keepAwakePins ?? [],
      };
    },
  };
}
