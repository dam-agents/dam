import type { AgentView } from "../../../types.js";
import { usePoolUsage } from "../api/queries.js";
import { formatBytes, memoryBar, storageBar } from "../lib/pools.js";
import { CpuRow } from "./cpu-row.js";
import { PoolBar } from "./pool-bar.js";
import { RequestMoreLink } from "./request-more-link.js";

const percentOf = (used: number, limit: number) =>
  limit > 0 ? Math.min(100, Math.floor((used * 100) / limit)) : 0;

export function PoolUsage({ agents }: { agents: readonly AgentView[] }) {
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
          <PoolBar
            title="Memory"
            value={`${formatBytes(usage.memory.usedBytes)} of ${formatBytes(usage.memory.limitBytes)}`}
            bar={memoryBar(usage, vmAgents)}
            percent={percentOf(usage.memory.usedBytes, usage.memory.limitBytes)}
            warning="Pause agents to free up memory."
          />
          <PoolBar
            title="Storage"
            value={`${formatBytes(usage.storage.usedBytes)} of ${formatBytes(usage.storage.usableBytes)}`}
            bar={storageBar(usage, vmAgents)}
            percent={percentOf(
              usage.storage.usedBytes,
              usage.storage.usableBytes,
            )}
            warning="Delete old agents, or ask them to clean up their disks."
          />
          {usage.cpu && (
            <CpuRow cpu={usage.cpu} usage={usage} agents={vmAgents} />
          )}
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
