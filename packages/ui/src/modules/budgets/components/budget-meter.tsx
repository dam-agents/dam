import type { CSSProperties } from "react";

import { Callout } from "@/components/ui/callout";

import { useBudgetReserved } from "../api/queries.js";
import { formatCores, formatGi } from "../lib/format.js";

function fillPercent(used: number, ceiling: number): number {
  return ceiling > 0 ? Math.min(100, Math.round((used / ceiling) * 100)) : 0;
}

interface DimensionProps {
  label: string;
  used: string;
  ceiling: string;
  unit: string;
  fill: number;
}

function Dimension({ label, used, ceiling, unit, fill }: DimensionProps) {
  return (
    <div className="flex-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {used} / {ceiling} {unit}
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

export function BudgetMeter() {
  const { data } = useBudgetReserved();
  if (!data) return null;
  const { cpu, memory } = data;
  return (
    <Callout
      className="mb-6 flex items-center gap-6"
      title="Compute your running sandboxes can use, against your budget. Pause or stop a sandbox to free room."
    >
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
    </Callout>
  );
}
