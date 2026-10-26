import { hashKey, type QueryKey } from "@tanstack/react-query";
import type { LiveEvent } from "api-server-api";

import { queryClient } from "../../query-client.js";
import { trpc } from "../../trpc.js";
import { agentsKeys } from "../agents/api/queries.js";
import { approvalsKeys } from "../approvals/api/queries.js";
import { egressRulesKeys } from "../egress-rules/api/queries.js";

type Topic = Exclude<LiveEvent["topic"], "sync">;

const harnessConfigOf = (agentId?: string): QueryKey =>
  agentId
    ? [...trpc.harnessConfig.pathKey(), { input: { agentId } }]
    : trpc.harnessConfig.pathKey();

const invalidations: Record<Topic, (agentId?: string) => readonly QueryKey[]> =
  {
    approvals: () => [approvalsKeys.all, egressRulesKeys.all],
    agents: (agentId) => [
      agentsKeys.root,
      trpc.starterKits.updates.queryKey(),
      trpc.budgets.pathKey(),
      trpc.environments.list.pathKey(),
      harnessConfigOf(agentId),
    ],
    schedules: () => [trpc.schedules.pathKey(), trpc.attention.pathKey()],
    harnessConfig: (agentId) => [harnessConfigOf(agentId)],
    kbShares: () => [trpc.kbShares.pathKey()],
    artifacts: () => [trpc.artifactLibrary.pathKey()],
    attention: () => [trpc.attention.pathKey()],
    gettingStarted: () => [trpc.gettingStarted.pathKey()],
  };

interface Pass {
  queryKey: QueryKey;
  done: (() => void)[];
}

const queued = new Map<string, Pass>();
const running = new Set<string>();

// UNIT_BOUNDARY_DESCRIPTION: one queue for every hint. A hint for a query family that is already queued joins that pass; one for a family that is refetching queues a single pass after it, so the data is as fresh as the last hint without a fetch per hint.
function refresh(queryKey: QueryKey): Promise<void> {
  const hash = hashKey(queryKey);
  return new Promise((resolve) => {
    const pass = queued.get(hash);
    if (pass) pass.done.push(resolve);
    else queued.set(hash, { queryKey, done: [resolve] });
    pump();
  });
}

function pump(): void {
  for (const [hash, pass] of queued) {
    if (running.has(hash)) continue;
    queued.delete(hash);
    running.add(hash);
    void queryClient
      .invalidateQueries({ queryKey: pass.queryKey })
      .finally(() => {
        running.delete(hash);
        for (const done of pass.done) done();
        pump();
      });
  }
}

export function invalidateForLiveEvent(event: LiveEvent): Promise<unknown> {
  const families =
    event.topic === "sync"
      ? Object.values(invalidations).flatMap((familiesOf) => familiesOf())
      : invalidations[event.topic](
          "agentId" in event ? event.agentId : undefined,
        );
  return Promise.all(families.map(refresh));
}
