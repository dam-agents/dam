import { cn } from "@/lib/utils";

import { useBudgetReserved } from "../../../budgets/api/queries.js";
import { formatBytes } from "../../../budgets/lib/pools.js";

interface Pool {
  label: string;
  value: string;
  fraction: number;
}

const tone = (fraction: number) =>
  fraction >= 0.9
    ? "bg-danger"
    : fraction >= 0.75
      ? "bg-warning"
      : "bg-muted-foreground/60";

const share = (used: number, total: number) =>
  total > 0 ? Math.min(1, used / total) : 0;

export function SidebarUsage({ onOpen }: { onOpen: () => void }) {
  const { data: budget } = useBudgetReserved();
  if (!budget) return null;
  const vm = budget.vm;
  const pools: Pool[] = [
    vm
      ? {
          label: "Memory",
          value: `${formatBytes(vm.memory.usedBytes)} / ${formatBytes(vm.memory.limitBytes)}`,
          fraction: share(vm.memory.usedBytes, vm.memory.limitBytes),
        }
      : {
          label: "Memory",
          value: `${formatBytes(budget.memory.reservedBytes)} / ${formatBytes(budget.memory.ceilingBytes)}`,
          fraction: share(
            budget.memory.reservedBytes,
            budget.memory.ceilingBytes,
          ),
        },
    {
      label: "Storage",
      value: vm
        ? `${formatBytes(vm.storage.usedBytes)} / ${formatBytes(vm.storage.usableBytes)}`
        : "—",
      fraction: vm ? share(vm.storage.usedBytes, vm.storage.usableBytes) : 0,
    },
  ];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Resource usage"
      data-testid="sidebar-usage"
      className="grid grid-cols-2 gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted"
    >
      {pools.map((pool) => (
        <div key={pool.label} className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-1.5 text-2xs">
            <span className="text-muted-foreground">{pool.label}</span>
            <span className="truncate text-foreground/80 tabular-nums">
              {pool.value}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", tone(pool.fraction))}
              style={{ width: `${pool.fraction * 100}%` }}
            />
          </div>
        </div>
      ))}
    </button>
  );
}
