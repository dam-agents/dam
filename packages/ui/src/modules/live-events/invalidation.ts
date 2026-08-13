import type { LiveEvent } from "api-server-api";

import { queryClient } from "../../query-client.js";
import { trpc } from "../../trpc.js";
import { agentsKeys } from "../agents/api/queries.js";
import { approvalsKeys } from "../approvals/api/queries.js";
import { egressRulesKeys } from "../egress-rules/api/queries.js";

type Topic = Exclude<LiveEvent["topic"], "sync">;

const invalidations: Record<Topic, () => readonly (readonly unknown[])[]> = {
  approvals: () => [approvalsKeys.all, egressRulesKeys.all],
  agents: () => [
    agentsKeys.root,
    trpc.budgets.pathKey(),
    trpc.harnessConfig.pathKey(),
  ],
  schedules: () => [trpc.schedules.pathKey()],
  harnessConfig: () => [trpc.harnessConfig.pathKey()],
  experiments: () => [trpc.experiments.pathKey()],
  artifacts: () => [trpc.artifactLibrary.pathKey()],
};

export function invalidateForLiveEvent(event: LiveEvent): void {
  const families =
    event.topic === "sync"
      ? Object.values(invalidations).flatMap((familiesOf) => familiesOf())
      : invalidations[event.topic]();
  for (const queryKey of families) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
