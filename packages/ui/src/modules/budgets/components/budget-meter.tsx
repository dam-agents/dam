import type { CSSProperties } from "react";

import { useBudgetUsage } from "../api/queries.js";

function formatCores(milli: number): string {
  const cores = milli / 1000;
  return Number.isInteger(cores) ? String(cores) : cores.toFixed(2);
}

function formatGi(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function fillPercent(used: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

interface DimensionProps {
  label: string;
  used: string;
  limit: string;
  unit: string;
  fill: number;
}

function Dimension({ label, used, limit, unit, fill }: DimensionProps) {
  return (
    <div className="flex-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {used} / {limit} {unit}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full w-[var(--fill)] rounded-full bg-primary"
          style={{ "--fill": `${fill}%` } as CSSProperties}
        />
      </div>
    </div>
  );
}

/** Reserved compute across the user's running sandboxes, against their ceiling. */
export function BudgetMeter() {
  const { data } = useBudgetUsage();
  if (!data) return null;
  const { cpu, memory } = data;
  return (
    <div
      className="mb-6 flex items-center gap-6 rounded-lg border border-border px-4 py-3"
      title="Reserved compute across your running sandboxes, against your limit."
    >
      <Dimension
        label="CPU"
        used={formatCores(cpu.reservedMilli)}
        limit={formatCores(cpu.limitMilli)}
        unit="cores"
        fill={fillPercent(cpu.reservedMilli, cpu.limitMilli)}
      />
      <Dimension
        label="Memory"
        used={formatGi(memory.reservedBytes)}
        limit={formatGi(memory.limitBytes)}
        unit="Gi"
        fill={fillPercent(memory.reservedBytes, memory.limitBytes)}
      />
    </div>
  );
}
