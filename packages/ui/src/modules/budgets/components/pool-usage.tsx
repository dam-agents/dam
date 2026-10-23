import type { PoolLevel } from "api-server-api";

import { getBrand } from "../../../brand.js";
import { formatBytes } from "../../../lib/format-size.js";
import type { AgentView } from "../../../types.js";
import { usePoolUsage } from "../api/queries.js";
import {
  memoryBar,
  poolWarning,
  storageBar,
  storageRows,
} from "../lib/pools.js";
import { RESOURCE_ICON } from "../lib/resource-icons.js";
import { CpuRow } from "./cpu-row.js";
import { PoolBar } from "./pool-bar.js";
import { StorageBreakdown } from "./storage-breakdown.js";

const LEVEL_WORD: Record<PoolLevel, string> = {
  ok: "",
  warning: ", nearly full",
  critical: ", full",
};

const percentOf = (used: number, limit: number) =>
  limit > 0 ? Math.min(100, Math.floor((used * 100) / limit)) : 0;

export function PoolUsage({ agents }: { agents: readonly AgentView[] }) {
  const { data: usage, isPending } = usePoolUsage();
  const vmAgents = [...agents];
  if (!usage) {
    if (isPending) return null;
    return (
      <p className="text-sm text-muted-foreground">
        {vmAgents.some((agent) => agent.state === "running")
          ? "Usage is unavailable right now — try again in a minute."
          : "Usage appears once one of your VM agents is running."}
      </p>
    );
  }
  const { memory, storage } = usage;
  // UNIT_BOUNDARY_DESCRIPTION: an agent can be out of room while the pool is not near full, since the guard gives each running agent only its part of the pool: the breakdown that names it opens on either, not only on the pool's own level, and it asks the shares whether a home is full rather than the rows it renders, so a disk the runner could not read cannot close it.
  const rows = storageRows(usage, vmAgents);
  const slackLogin = usage.slackUnlinked
    ? `/${getBrand().short} login`
    : undefined;
  const memoryValue = `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.limitBytes)}`;
  const storageValue = `${formatBytes(storage.usedBytes)} of ${formatBytes(storage.usableBytes)}`;
  return (
    <div className="flex flex-col gap-4">
      <PoolBar
        title="Memory"
        icon={RESOURCE_ICON.memory}
        value={memoryValue}
        valueText={`${memoryValue}${LEVEL_WORD[memory.level]}`}
        bar={memoryBar(usage, vmAgents)}
        percent={percentOf(memory.usedBytes, memory.limitBytes)}
        warning={poolWarning(
          memory.level,
          "Disable agents you aren't using to free up memory.",
          "Idle agents are put to sleep automatically to make room.",
          slackLogin,
        )}
      />
      <PoolBar
        title="Storage"
        icon={RESOURCE_ICON.storage}
        value={storageValue}
        valueText={`${storageValue}${LEVEL_WORD[storage.level]}`}
        bar={storageBar(usage, vmAgents)}
        percent={percentOf(storage.usedBytes, storage.usableBytes)}
        warning={poolWarning(
          storage.level,
          "Delete old agents, or ask them to clean up their disks.",
          "New VM agents can't be created until space is freed.",
          slackLogin,
        )}
      />
      {(storage.level !== "ok" ||
        usage.agents.some((share) => share.homeFull)) && (
        <StorageBreakdown rows={rows} />
      )}
      {usage.cpu && <CpuRow cpu={usage.cpu} usage={usage} agents={vmAgents} />}
    </div>
  );
}
