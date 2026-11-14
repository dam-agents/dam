import type { BudgetVmUsage, PoolLevel } from "api-server-api";

import { getBrand } from "../../../brand.js";
import { formatBytes } from "../../../lib/format-size.js";
import type { AgentView } from "../../../types.js";
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

export function PoolUsage({
  usage,
  agents,
}: {
  usage: BudgetVmUsage;
  agents: readonly AgentView[];
}) {
  const ownAgents = agents;
  const { memory, storage } = usage;
  // UNIT_BOUNDARY_DESCRIPTION: an agent can be out of room while the pool is not near full, since the guard holds each running agent to the pool's room above its reserve, and a home also fills on its own: the breakdown that names it opens on either, not only on the pool's own level, and it asks the shares whether a home is full rather than the rows it renders, so a disk the runner could not read cannot close it.
  const rows = storageRows(usage, ownAgents);
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
        bar={memoryBar(usage, ownAgents)}
        percent={percentOf(memory.usedBytes, memory.limitBytes)}
        warning={poolWarning(
          memory.level,
          "Delete an agent you no longer use to free up memory.",
          "Idle agents stop automatically to make room.",
          slackLogin,
        )}
      />
      <PoolBar
        title="Storage"
        icon={RESOURCE_ICON.storage}
        value={storageValue}
        valueText={`${storageValue}${LEVEL_WORD[storage.level]}`}
        bar={storageBar(usage, ownAgents)}
        percent={percentOf(storage.usedBytes, storage.usableBytes)}
        warning={poolWarning(
          storage.level,
          "Delete old agents, or ask them to clean up their disks.",
          "New agents can't be created until space is freed.",
          slackLogin,
        )}
      />
      {(storage.level !== "ok" ||
        usage.agents.some((share) => share.homeFull)) && (
        <StorageBreakdown rows={rows} />
      )}
      {usage.cpu && <CpuRow cpu={usage.cpu} usage={usage} agents={ownAgents} />}
    </div>
  );
}
