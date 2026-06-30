import type { UseFormRegisterReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";

import { FormError } from "../../../components/form-error.js";

interface Props {
  register: UseFormRegisterReturn;
  value: number;
  error?: string;
  disabled?: boolean;
}

// Per-agent idle-timeout setting: minutes of inactivity before the sandbox hibernates, 0 = never.
export function HibernationTimeoutField({
  register,
  value,
  error,
  disabled,
}: Props) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <Input
          type="number"
          min={0}
          step={1}
          className="w-28"
          disabled={disabled}
          data-testid="hibernation-timeout-input"
          {...register}
        />
        <span className="text-[13px] text-muted-foreground">
          {value === 0 ? "Never hibernates" : "minutes of inactivity"}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Idle minutes before the sandbox hibernates to free resources (it wakes
        on the next message). <strong>0</strong> = never — for background work
        that runs with no open session.
      </p>
      <FormError message={error} />
    </div>
  );
}
