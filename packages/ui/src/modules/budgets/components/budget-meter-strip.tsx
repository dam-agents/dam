import type { CSSProperties } from "react";

import { useBudgetReserved } from "../api/queries.js";
import { formatCores, formatGi } from "../lib/format.js";

function fillPercent(used: number, ceiling: number): number {
  return ceiling > 0 ? Math.min(100, Math.round((used / ceiling) * 100)) : 0;
}

export function BudgetMeterStrip() {
  const { data } = useBudgetReserved();
  if (!data) return null;
  const { cpu, memory } = data;

  return (
    <div className="sticky top-0 z-10 flex items-center gap-6 border-b border-border bg-card/95 px-6 py-2 backdrop-blur-sm">
      <span className="text-[14px] font-medium text-muted-foreground">
        Budget
      </span>
      <StripDimension
        label="CPU"
        used={formatCores(cpu.reservedMilli)}
        ceiling={formatCores(cpu.ceilingMilli)}
        unit="cores"
        fill={fillPercent(cpu.reservedMilli, cpu.ceilingMilli)}
      />
      <StripDimension
        label="Memory"
        used={formatGi(memory.reservedBytes)}
        ceiling={formatGi(memory.ceilingBytes)}
        unit="Gi"
        fill={fillPercent(memory.reservedBytes, memory.ceilingBytes)}
      />
    </div>
  );
}

function StripDimension({
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
    <div className="flex items-center gap-2">
      <span className="text-[14px] text-muted-foreground">
        {label}: {used}/{ceiling} {unit}
      </span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full w-[var(--fill)] rounded-full bg-primary"
          style={{ "--fill": `${fill}%` } as CSSProperties}
        />
      </div>
    </div>
  );
}
