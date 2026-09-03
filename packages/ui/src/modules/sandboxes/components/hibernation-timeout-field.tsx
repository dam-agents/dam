import { Power, Time } from "@carbon/icons-react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { CardButton } from "@/components/ui/card-button";
import { Input } from "@/components/ui/input";

import { FormError } from "../../../components/form-error.js";
import { formatCores, formatGi } from "../../budgets/lib/format.js";
import { parseCpuMilli, parseMemoryMi } from "../lib/quantity.js";

const DEFAULT_TIMEOUT_MIN = 60;

interface Props {
  register: UseFormRegisterReturn;
  value: number;
  onModeChange: (min: number) => void;
  agentSize?: { cpu?: string; memory?: string };
  error?: string;
  disabled?: boolean;
}

function costNote(size?: { cpu?: string; memory?: string }): string | null {
  if (!size?.cpu && !size?.memory) return null;
  const cpu = parseCpuMilli(size.cpu);
  const mem = parseMemoryMi(size.memory);
  if (!cpu && !mem) return null;
  const parts: string[] = [];
  if (cpu) parts.push(`${formatCores(cpu)} CPU`);
  if (mem) parts.push(`${formatGi(mem * 1024 ** 2)} Gi memory`);
  return `Reserves ${parts.join(" and ")} against your budget while idle.`;
}

export function HibernationTimeoutField({
  register,
  value,
  onModeChange,
  agentSize,
  error,
  disabled,
}: Props) {
  const neverHibernate = value === 0;
  const cost = costNote(agentSize);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <CardButton
          selected={!neverHibernate}
          disabled={disabled}
          onClick={() => {
            if (neverHibernate) onModeChange(DEFAULT_TIMEOUT_MIN);
          }}
          className="flex items-start gap-3 p-3"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Time size={16} className="text-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Hibernate while idle
            </p>
            <p className="text-sm text-muted-foreground">
              Frees compute when not in use
            </p>
          </div>
        </CardButton>

        <CardButton
          selected={neverHibernate}
          disabled={disabled}
          onClick={() => {
            if (!neverHibernate) onModeChange(0);
          }}
          className="flex items-start gap-3 p-3"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Power size={16} className="text-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Always on
            </p>
            <p className="text-sm text-muted-foreground">
              Instant response, holds compute
            </p>
          </div>
        </CardButton>
      </div>

      {!neverHibernate && (
        <div className="mt-3 flex items-center gap-3 animate-in fade-in duration-200">
          <Input
            type="number"
            min={1}
            step={1}
            className="w-28"
            disabled={disabled}
            data-testid="hibernation-timeout-input"
            {...register}
          />
          <span className="text-sm text-muted-foreground">
            minutes of inactivity
          </span>
        </div>
      )}

      {neverHibernate && cost && (
        <p className="mt-3 text-sm text-muted-foreground animate-in fade-in duration-200">
          {cost}
        </p>
      )}

      <FormError message={error} />
    </div>
  );
}
