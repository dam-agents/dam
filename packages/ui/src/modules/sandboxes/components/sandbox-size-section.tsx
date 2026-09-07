import { Help } from "@carbon/icons-react";

import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { HintTooltip } from "@/components/ui/tooltip";

import { useBudgetReserved } from "../../budgets/api/queries.js";
import { formatCores, formatGi } from "../../budgets/lib/format.js";
import {
  formatSizeLabel,
  freeSlots,
  SIZE_MULTIPLIERS,
  sizeForMultiplier,
  sizeInMi,
  type SizeMi,
  slotsFor,
  slotUnitOf,
} from "../../budgets/lib/slots.js";

interface Props {
  sizeCpuMilli: number;
  sizeMemoryMi: number;
  onChange: (patch: { sizeCpuMilli: number; sizeMemoryMi: number }) => void;
  disabled?: boolean;
  currentSize?: { cpu?: string; memory?: string };
}

const keyOf = (s: SizeMi) => `${s.cpuMilli}:${s.memoryMi}`;

export function SandboxSizeSection({
  sizeCpuMilli,
  sizeMemoryMi,
  onChange,
  disabled,
  currentSize,
}: Props) {
  const { data: budget } = useBudgetReserved();
  const unit = budget ? slotUnitOf(budget) : null;
  const selected: SizeMi = { cpuMilli: sizeCpuMilli, memoryMi: sizeMemoryMi };
  const presets = unit
    ? SIZE_MULTIPLIERS.map((m) => sizeForMultiplier(unit, m))
    : [];
  const options = presets.some((p) => keyOf(p) === keyOf(selected))
    ? presets
    : [...presets, selected].sort(
        (a, b) => a.cpuMilli - b.cpuMilli || a.memoryMi - b.memoryMi,
      );

  const needed = unit ? slotsFor(selected, unit) : 0;
  const free =
    budget && unit
      ? freeSlots(budget, unit, currentSize ? sizeInMi(currentSize) : undefined)
      : Infinity;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-1.5">
        <SectionLabel>Compute resources</SectionLabel>
        <HintTooltip
          label="About compute resources"
          content={`Compute counts toward your budget only when the sandbox is active. ${
            currentSize
              ? "Changing the size restarts the sandbox on save."
              : "The new size applies when the sandbox next starts."
          }`}
        >
          <Help size={14} className="text-muted-foreground/60" />
        </HintTooltip>
      </div>
      <Inset>
        <Select
          aria-label="Compute resources"
          value={keyOf(selected)}
          disabled={disabled || !unit}
          onChange={(e) => {
            const [cpuMilli, memoryMi] = e.target.value.split(":").map(Number);
            onChange({ sizeCpuMilli: cpuMilli!, sizeMemoryMi: memoryMi! });
          }}
        >
          {options.map((option) => (
            <option key={keyOf(option)} value={keyOf(option)}>
              {unit
                ? formatSizeLabel(option, unit)
                : `${formatCores(option.cpuMilli)} CPU · ${formatGi(option.memoryMi * 1024 ** 2)} Gi`}
            </option>
          ))}
        </Select>
      </Inset>
      {!disabled && needed > free && (
        <p className="mt-3 text-sm text-warning">
          This size needs {needed} {needed === 1 ? "slot" : "slots"} but only{" "}
          {free} {free === 1 ? "is" : "are"} free.{" "}
          {currentSize
            ? "Hibernate or stop another sandbox before growing this one."
            : "The agent will wait parked until you hibernate or stop another sandbox."}
        </p>
      )}
    </section>
  );
}
