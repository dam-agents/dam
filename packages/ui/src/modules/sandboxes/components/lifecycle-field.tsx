import { Power, Time } from "@carbon/icons-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { FormError } from "../../../components/form-error.js";
import { formatCores } from "../../budgets/lib/format.js";
import type { SizeMi } from "../../budgets/lib/slots.js";

const DEFAULT_HIBERNATE_MIN = 60;

interface Props {
  value: number;
  onChange: (next: number) => void;
  sizeMi?: SizeMi;
  error?: string;
  disabled?: boolean;
}

export function LifecycleField({
  value,
  onChange,
  sizeMi,
  error,
  disabled,
}: Props) {
  const alwaysOn = value === 0;
  const [lastMinutes, setLastMinutes] = useState(
    value > 0 ? value : DEFAULT_HIBERNATE_MIN,
  );

  const pickHibernate = () => {
    if (alwaysOn) onChange(lastMinutes);
  };
  const pickAlwaysOn = () => {
    if (!alwaysOn) {
      if (value > 0) setLastMinutes(value);
      onChange(0);
    }
  };

  return (
    <Card className="p-4">
      <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
        <OptionCard
          icon={Time}
          title="Hibernate when idle"
          description="Requires time to start. Frees compute when not in use."
          selected={!alwaysOn}
          disabled={disabled}
          onSelect={pickHibernate}
          testid="lifecycle-hibernate"
        />
        <OptionCard
          icon={Power}
          title="Always on"
          description="Instant response (never idles). Always reserves compute."
          selected={alwaysOn}
          disabled={disabled}
          onSelect={pickAlwaysOn}
          testid="lifecycle-always-on"
        />
      </div>
      {alwaysOn ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {reserveLine(sizeMi)}
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <Input
            type="number"
            min={1}
            step={1}
            className="w-28"
            disabled={disabled}
            value={Number.isNaN(value) ? "" : value}
            onChange={(event) => {
              const next = event.target.valueAsNumber;
              if (next === 0) {
                setLastMinutes(DEFAULT_HIBERNATE_MIN);
                onChange(0);
                return;
              }
              onChange(next);
            }}
            aria-label="Minutes of inactivity"
            data-testid="hibernation-timeout-input"
          />
          <span className="text-sm text-muted-foreground">
            minutes of inactivity
          </span>
        </div>
      )}
      <FormError message={error} />
    </Card>
  );
}

function reserveLine(sizeMi?: SizeMi): string {
  if (!sizeMi || sizeMi.cpuMilli <= 0 || sizeMi.memoryMi <= 0)
    return "Reserves its compute against your budget while idle.";
  return `Reserves ${formatCores(sizeMi.cpuMilli)} CPU and ${formatMemory(
    sizeMi.memoryMi,
  )} memory against your budget while idle.`;
}

function formatMemory(mi: number): string {
  return mi % 1024 === 0 ? `${mi / 1024} Gi` : `${mi} Mi`;
}

function OptionCard({
  icon: Icon,
  title,
  description,
  selected,
  disabled,
  onSelect,
  testid,
}: {
  icon: typeof Time;
  title: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testid}
      className={cn(
        "flex items-center gap-3 rounded-md border p-3 text-left transition-colors",
        selected
          ? "border-foreground bg-muted/40"
          : "border-border hover:bg-muted/40",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon size={16} className="text-foreground" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
