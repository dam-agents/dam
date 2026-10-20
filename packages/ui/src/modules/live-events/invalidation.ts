import { hashKey, type QueryKey } from "@tanstack/react-query";
import type { LiveEvent } from "api-server-api";

import { queryClient } from "../../query-client.js";
import { trpc } from "../../trpc.js";
import { agentsKeys } from "../agents/api/queries.js";
import { approvalsKeys } from "../approvals/api/queries.js";
import { egressRulesKeys } from "../egress-rules/api/queries.js";
import { acpSessionsKeys } from "../sessions/api/keys.js";

type Topic = Exclude<LiveEvent["topic"], "sync">;

const harnessConfigOf = (agentId?: string): QueryKey =>
  agentId
    ? [...trpc.harnessConfig.pathKey(), { input: { agentId } }]
    : trpc.harnessConfig.pathKey();

function newLayoutOn(): boolean {
  return (
    queryClient.getQueryData<Record<string, boolean>>(
      trpc.features.flags.queryKey(),
    )?.["new-layout"] === true
  );
}

function cachedSessionAgents(): string[] {
  const ids = queryClient
    .getQueryCache()
    .findAll({ queryKey: acpSessionsKeys.all })
    .map((query) => acpSessionsKeys.agentIdOf(query.queryKey));
  return [...new Set(ids)].filter((id) => id !== null);
}

const invalidations: Record<Topic, (agentId?: string) => readonly QueryKey[]> =
  {
    approvals: () => [approvalsKeys.all, egressRulesKeys.all],
    agents: (agentId) => [
      agentsKeys.root,
      trpc.starterKits.updates.queryKey(),
      trpc.budgets.pathKey(),
      harnessConfigOf(agentId),
    ],
    schedules: () => [trpc.schedules.pathKey()],
    harnessConfig: (agentId) => [harnessConfigOf(agentId)],
    kbShares: () => [trpc.kbShares.pathKey()],
    artifacts: () => [trpc.artifactLibrary.pathKey()],
    attention: (agentId) => [
      trpc.attention.pathKey(),
      ...(!newLayoutOn()
        ? []
        : agentId
          ? [agentId]
          : cachedSessionAgents()
      ).flatMap((id) => [
        acpSessionsKeys.pages(id),
        acpSessionsKeys.sessions(id),
      ]),
    ],
    gettingStarted: () => [trpc.gettingStarted.pathKey()],
  };

const refreshing = new Map<string, { again: boolean }>();

const REFRESH_CONCURRENCY = 8;

async function inParallel(
  families: readonly QueryKey[],
  limit: number,
): Promise<void> {
  const queue = [...families];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let key = queue.shift(); key; key = queue.shift())
        await refresh(key);
    }),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: a burst of hints for one query family runs one refetch, and at most one more after it. A hint that arrives while the family refetches only asks for that next pass, so the data is as fresh as the last hint, and the same fetch is not cancelled and sent again for every hint in the burst.
async function refresh(queryKey: QueryKey): Promise<void> {
  const hash = hashKey(queryKey);
  const running = refreshing.get(hash);
  if (running) {
    running.again = true;
    return;
  }
  const state = { again: true };
  refreshing.set(hash, state);
  while (state.again) {
    state.again = false;
    await queryClient.invalidateQueries({ queryKey });
  }
  refreshing.delete(hash);
}

export function invalidateForLiveEvent(event: LiveEvent): Promise<unknown> {
  const families =
    event.topic === "sync"
      ? Object.values(invalidations).flatMap((familiesOf) => familiesOf())
      : invalidations[event.topic](
          "agentId" in event ? event.agentId : undefined,
        );
  return inParallel(families, REFRESH_CONCURRENCY);
}
