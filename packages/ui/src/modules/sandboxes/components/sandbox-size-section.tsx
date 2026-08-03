import { SectionLabel } from "@/components/ui/section-label";
import { Slider } from "@/components/ui/slider";

import { useBudgetReserved } from "../../budgets/api/queries.js";
import { formatCores, formatMiAsMemory } from "../../budgets/lib/format.js";
import { parseCpuMilli, parseMemoryMi } from "../lib/quantity.js";

// Floors mirror the server-side slider validation (agentSizeSchema).
const CPU_FLOOR_MILLI = 100;
const MEMORY_FLOOR_MI = 384;
const CPU_STEP_MILLI = 100;
const MEMORY_STEP_MI = 128;

// The chart default Size, shown when neither the slider nor the template
// chooses. Display seed only — an untouched slider sends no `size` and the
// server applies its own default.
const FALLBACK_CPU_MILLI = 1000;
const FALLBACK_MEMORY_MI = 1024;

interface Props {
  /** The selected template's default Size, when it declares one. */
  templateSize?: { cpu?: string; memory?: string };
  sizeCpuMilli: number | null;
  sizeMemoryMi: number | null;
  onChange: (patch: { sizeCpuMilli?: number; sizeMemoryMi?: number }) => void;
  disabled?: boolean;
  /** Settings-only: what saving a size change does to this sandbox. */
  restartNote?: string;
  /** Settings-only: the sandbox's current Size when it is UP — its own
   *  contribution is already inside `reserved`, so a resize only spends
   *  the difference. */
  currentSize?: { cpu?: string; memory?: string };
}

/** CPU/memory sliders for the sandbox's Size — how much it can use while
 *  running. Bounded below by the platform floors and above by the user's
 *  budget Ceiling; defaults to the template's Size. Warns (without blocking)
 *  when the chosen Size exceeds the room currently free — the sandbox would
 *  wait parked until something else stops. */
export function SandboxSizeSection({
  templateSize,
  sizeCpuMilli,
  sizeMemoryMi,
  onChange,
  disabled,
  restartNote,
  currentSize,
}: Props) {
  const { data: budget } = useBudgetReserved();

  const defaultCpu = parseCpuMilli(templateSize?.cpu) ?? FALLBACK_CPU_MILLI;
  const defaultMemory =
    parseMemoryMi(templateSize?.memory) ?? FALLBACK_MEMORY_MI;
  const cpu = sizeCpuMilli ?? defaultCpu;
  const memory = sizeMemoryMi ?? defaultMemory;

  const cpuMax = Math.max(budget?.cpu.ceilingMilli ?? 4000, cpu);
  const memoryMax = Math.max(
    Math.floor((budget?.memory.ceilingBytes ?? 8 * 1024 ** 3) / 1024 ** 2),
    memory,
  );

  // Headroom from the last poll — advisory only (enforcement is the
  // controller's); a size past it parks the sandbox rather than failing.
  // An up sandbox's own Size is already counted in `reserved`, so credit it
  // back — a resize only spends the difference.
  const ownCpu = parseCpuMilli(currentSize?.cpu) ?? 0;
  const ownMemoryMi = parseMemoryMi(currentSize?.memory) ?? 0;
  const freeCpu = budget
    ? budget.cpu.ceilingMilli - budget.cpu.reservedMilli + ownCpu
    : null;
  const freeMemoryMi = budget
    ? Math.floor(
        (budget.memory.ceilingBytes - budget.memory.reservedBytes) / 1024 ** 2,
      ) + ownMemoryMi
    : null;
  const cpuOver = freeCpu !== null && cpu > freeCpu;
  const memoryOver = freeMemoryMi !== null && memory > freeMemoryMi;

  return (
    <section className="mb-8">
      <SectionLabel>Size</SectionLabel>
      <p className="mb-3 text-sm text-muted-foreground">
        How much compute this sandbox can use while running. It counts against
        your budget only while the sandbox is up.
      </p>
      <div className="flex flex-col gap-4">
        <SizeSlider
          label="CPU"
          valueLabel={`${formatCores(cpu)} cores`}
          value={cpu}
          min={CPU_FLOOR_MILLI}
          max={cpuMax}
          step={CPU_STEP_MILLI}
          over={cpuOver}
          disabled={disabled}
          onChange={(v) => onChange({ sizeCpuMilli: v })}
        />
        <SizeSlider
          label="Memory"
          valueLabel={formatMiAsMemory(memory)}
          value={memory}
          min={MEMORY_FLOOR_MI}
          max={memoryMax}
          step={MEMORY_STEP_MI}
          over={memoryOver}
          disabled={disabled}
          onChange={(v) => onChange({ sizeMemoryMi: v })}
        />
      </div>
      {restartNote && (
        <p className="mt-3 text-sm text-muted-foreground">{restartNote}</p>
      )}
      {!disabled && (cpuOver || memoryOver) && freeCpu !== null && (
        <p className="mt-3 text-sm text-warning">
          This size is larger than the room currently free on your budget (
          {formatCores(Math.max(freeCpu, 0))} cores /{" "}
          {formatMiAsMemory(Math.max(freeMemoryMi ?? 0, 0))}). The sandbox will
          wait parked — pause or stop another one, then start it.
        </p>
      )}
    </section>
  );
}

interface SizeSliderProps {
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  over: boolean;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function SizeSlider({
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  over,
  disabled,
  onChange,
}: SizeSliderProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span
          className={
            over
              ? "tabular-nums text-warning"
              : "tabular-nums text-muted-foreground"
          }
        >
          {valueLabel}
        </span>
      </div>
      <Slider
        label={`${label} size`}
        value={value}
        min={min}
        max={max}
        step={step}
        valueText={valueLabel}
        disabled={disabled}
        onValueChange={onChange}
      />
    </div>
  );
}
