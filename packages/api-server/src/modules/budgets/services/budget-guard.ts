import { TRPCError } from "@trpc/server";
import type { BudgetUsage } from "api-server-api";
import type { UserBudgetsRepository } from "../infrastructure/user-budgets-repository.js";
import {
  ZERO,
  add,
  footprint,
  wouldExceed,
  type ResourceAmount,
  type ResourceRequests,
} from "../domain/resources.js";

/** Port over the agents' K8s state — the authoritative running set. */
export interface RunningAgentsPort {
  /** Non-hibernated agents owned by `owner`, each with its raw requests. */
  listRunning(
    owner: string,
  ): Promise<{ requests: ResourceRequests | undefined }[]>;
  /** An agent's owner, requests, and whether it is currently hibernated. */
  describe(agentId: string): Promise<{
    owner: string;
    requests: ResourceRequests | undefined;
    hibernated: boolean;
  } | null>;
}

export interface BudgetGuard {
  usage(owner: string): Promise<BudgetUsage>;
  /** Throws when creating an agent with `requests` would breach the owner's ceiling. */
  assertCreateAllowed(
    owner: string,
    requests: ResourceRequests | undefined,
  ): Promise<void>;
  /** Throws when waking a hibernated agent would breach its owner's ceiling; no-op otherwise. */
  assertWakeAllowed(agentId: string): Promise<void>;
}

export function createBudgetGuard(deps: {
  running: RunningAgentsPort;
  budgets: UserBudgetsRepository;
  agentDefault: ResourceAmount;
  defaultCeiling: ResourceAmount;
}): BudgetGuard {
  async function reservedAndLimit(
    owner: string,
  ): Promise<{ reserved: ResourceAmount; limit: ResourceAmount }> {
    const [running, override] = await Promise.all([
      deps.running.listRunning(owner),
      deps.budgets.ceiling(owner),
    ]);
    const reserved = running.reduce(
      (acc, a) => add(acc, footprint(a.requests, deps.agentDefault)),
      ZERO,
    );
    return { reserved, limit: override ?? deps.defaultCeiling };
  }

  async function assertWithin(
    owner: string,
    candidate: ResourceAmount,
  ): Promise<void> {
    const { reserved, limit } = await reservedAndLimit(owner);
    if (wouldExceed(reserved, candidate, limit))
      throw overBudget(reserved, candidate, limit);
  }

  return {
    async usage(owner) {
      const { reserved, limit } = await reservedAndLimit(owner);
      return {
        cpu: { reservedMilli: reserved.cpuMilli, limitMilli: limit.cpuMilli },
        memory: {
          reservedBytes: reserved.memoryBytes,
          limitBytes: limit.memoryBytes,
        },
      };
    },

    assertCreateAllowed(owner, requests) {
      return assertWithin(owner, footprint(requests, deps.agentDefault));
    },

    async assertWakeAllowed(agentId) {
      const a = await deps.running.describe(agentId);
      if (!a || !a.hibernated) return;
      await assertWithin(a.owner, footprint(a.requests, deps.agentDefault));
    },
  };
}

function overBudget(
  reserved: ResourceAmount,
  candidate: ResourceAmount,
  limit: ResourceAmount,
): TRPCError {
  const cpu = (n: number) => `${(n / 1000).toFixed(2)} CPU`;
  const mem = (n: number) => `${(n / 1024 ** 3).toFixed(2)} Gi`;
  return new TRPCError({
    code: "FORBIDDEN",
    message:
      `Over your compute budget: this would reserve ${cpu(reserved.cpuMilli + candidate.cpuMilli)} / ${cpu(limit.cpuMilli)} ` +
      `and ${mem(reserved.memoryBytes + candidate.memoryBytes)} / ${mem(limit.memoryBytes)}. Stop a running agent to free room.`,
  });
}
