import type { CSSProperties } from "react";

import { useBudgetReserved } from "../api/queries.js";
import { formatCores, formatGi } from "../lib/format.js";

function fillPercent(used: number, ceiling: number): number {
  return ceiling > 0 ? Math.min(100, Math.round((used / ceiling) * 100)) : 0;
}

export function BudgetMeterCompact() {
  const { data } = useBudgetReserved();
  if (!data) return null;
  const { cpu, memory } = data;

  return (
    <div className="flex w-full flex-col gap-3.5 rounded-lg border border-border/60 bg-muted/10 px-3 py-3">
      <Dimension
        label="CPU"
        used={formatCores(cpu.reservedMilli)}
        ceiling={formatCores(cpu.ceilingMilli)}
        unit="cores"
        fill={fillPercent(cpu.reservedMilli, cpu.ceilingMilli)}
      />
      <Dimension
        label="Memory"
        used={formatGi(memory.reservedBytes)}
        ceiling={formatGi(memory.ceilingBytes)}
        unit="Gi"
        fill={fillPercent(memory.reservedBytes, memory.ceilingBytes)}
      />
    </div>
  );
}

function Dimension({
  label,
  used,
  ceiling,
  unit,
  fill,
}: {
  label: string;
  used: string;
  ceiling: string;
  unit: string;
  fill: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {used} / {ceiling} {unit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full w-[var(--fill)] rounded-full bg-primary"
          style={{ "--fill": `${fill}%` } as CSSProperties}
        />
      </div>
    </div>
  );
}
