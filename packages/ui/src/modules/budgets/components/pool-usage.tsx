import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { usePoolUsage } from "../api/queries.js";
import {
  idleVmAgents,
  largestVmAgents,
  memoryBar,
  storageBar,
} from "../lib/pools.js";
import { CpuRow } from "./cpu-row.js";
import { MemoryFixes } from "./memory-fixes.js";
import { PoolBar } from "./pool-bar.js";
import { RequestMoreLink } from "./request-more-link.js";
import { StorageFixes } from "./storage-fixes.js";

interface PoolActions {
  onPause: (agent: AgentView) => void;
  onStop: (agent: AgentView) => void;
  onDelete: (agent: AgentView) => void;
}

interface Props extends PoolActions {
  agents: readonly AgentView[];
  workingAgentIds: ReadonlySet<string>;
}

export function PoolUsage({
  agents,
  workingAgentIds,
  onPause,
  onStop,
  onDelete,
}: Props) {
  const { data: usage, isPending } = usePoolUsage();
  const pausingAgents = useStore((s) => s.pausingAgents);
  const busyIds = useMemo(
    () => new Set([...workingAgentIds, ...pausingAgents.keys()]),
    [workingAgentIds, pausingAgents],
  );
  const vmAgents = agents.filter((agent) => agent.vm);
  if (!usage)
    return (
      <div className="flex flex-col gap-4">
        <Header />
        {!isPending && (
          <p className="text-sm text-muted-foreground">
            Usage is unavailable right now.
          </p>
        )}
      </div>
    );
  const memory = memoryBar(usage, vmAgents);
  const storage = storageBar(usage, vmAgents);
  return (
    <div className="flex flex-col gap-4">
      <Header />
      <PoolBar title="Memory" bar={memory} />
      {memory.level !== "ok" && (
        <MemoryFixes
          idle={idleVmAgents(usage, vmAgents, busyIds)}
          critical={memory.level === "critical"}
          onPause={onPause}
          onStop={onStop}
        />
      )}
      <PoolBar title="Storage" bar={storage} />
      {storage.level !== "ok" && (
        <StorageFixes
          largest={largestVmAgents(usage, vmAgents)}
          critical={storage.level === "critical"}
          onDelete={onDelete}
        />
      )}
      <CpuRow usage={usage} agents={vmAgents} />
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground">Your agents' resources</span>
      <RequestMoreLink />
    </div>
  );
}
