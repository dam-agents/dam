import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

import { useAgentsList } from "../../../agents/api/queries.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { useBudgetReserved } from "../../../budgets/api/queries.js";
import { formatBytes } from "../../../budgets/lib/pools.js";
import {
  type SidebarPool,
  sidebarPools,
  usageShare,
} from "../../../budgets/lib/sidebar-pools.js";

const tone = (fraction: number) =>
  fraction >= 0.9
    ? "bg-danger"
    : fraction >= 0.75
      ? "bg-warning"
      : "bg-muted-foreground/60";

export function SidebarUsage({ onOpen }: { onOpen: () => void }) {
  const { data: budget } = useBudgetReserved();
  const agents = useAgentsList();
  if (!budget) return null;
  return (
    <div className="grid grid-cols-2 gap-1" data-testid="sidebar-usage">
      {sidebarPools(budget, agents).map((pool) => (
        <PoolMeter key={pool.label} pool={pool} onOpen={onOpen} />
      ))}
    </div>
  );
}

function PoolMeter({
  pool,
  onOpen,
}: {
  pool: SidebarPool;
  onOpen: () => void;
}) {
  const fraction = usageShare(pool.usedBytes, pool.totalBytes);
  const measured = pool.totalBytes > 0;
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${pool.label} by agent`}
          className="flex min-w-0 flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted"
        >
          <div className="flex items-baseline justify-between gap-1.5 text-2xs">
            <span className="text-muted-foreground">{pool.label}</span>
            <span className="truncate text-foreground/80 tabular-nums">
              {measured ? formatBytes(pool.usedBytes) : "—"}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", tone(fraction))}
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">
            {pool.label}
          </span>
          {measured && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatBytes(pool.usedBytes)} of {formatBytes(pool.totalBytes)}
            </span>
          )}
        </div>
        {pool.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No agent uses any right now.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {pool.rows.map((row) => (
              <li
                key={row.agent?.id ?? row.label}
                className="flex flex-col gap-1"
              >
                <div className="flex items-center gap-2 text-xs">
                  {row.agent ? (
                    <AgentAvatar
                      name={row.agent.name}
                      avatar={row.agent.avatar}
                      size={16}
                      mood={avatarMood(row.agent.state, row.agent)}
                      className="shrink-0"
                    />
                  ) : (
                    <span className="size-4 shrink-0 rounded-sm bg-muted" />
                  )}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      row.agent ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {row.label}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatBytes(row.bytes)}
                  </span>
                </div>
                <div className="ml-6 h-0.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-muted-foreground/60"
                    style={{
                      width: `${usageShare(row.bytes, pool.totalBytes || pool.usedBytes) * 100}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
