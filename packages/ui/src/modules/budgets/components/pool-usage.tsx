import type { AgentView } from "../../../types.js";
import { usePoolUsage } from "../api/queries.js";
import { memoryBar, storageBar } from "../lib/pools.js";
import { CpuRow } from "./cpu-row.js";
import { PoolBar } from "./pool-bar.js";
import { RequestMoreLink } from "./request-more-link.js";

interface Props {
  agents: readonly AgentView[];
}

export function PoolUsage({ agents }: Props) {
  const { data: usage, isPending } = usePoolUsage();
  const vmAgents = agents.filter((agent) => agent.vm);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground">Your agents' resources</span>
        <RequestMoreLink />
      </div>
      {usage ? (
        <>
          <PoolBar title="Memory" bar={memoryBar(usage, vmAgents)} />
          <PoolBar title="Storage" bar={storageBar(usage, vmAgents)} />
          <CpuRow usage={usage} agents={vmAgents} />
        </>
      ) : (
        !isPending && (
          <p className="text-sm text-muted-foreground">
            Usage is unavailable right now.
          </p>
        )
      )}
    </div>
  );
}
