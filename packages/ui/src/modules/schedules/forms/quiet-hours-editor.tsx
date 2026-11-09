import {
  type Control,
  Controller,
  useFieldArray,
  type UseFormRegister,
  useWatch,
} from "react-hook-form";

import { RemoveButton } from "@/components/ui/remove-button";
import { Switch } from "@/components/ui/switch";

import { FormError } from "../../../components/form-error.js";
import { TIME_OPTIONS } from "../lib/schedule-form-options.js";
import { RowAddButton, RowHint, RowSelect } from "./schedule-fields.js";
import type { ScheduleFormValues } from "./schedule-form-schema.js";

const QUIET_HOURS_HINT =
  "Runs inside a window are suppressed; start is inside, end is outside.";

const timeOptions = TIME_OPTIONS.map((o) => (
  <option key={o.value} value={o.value}>
    {o.label}
  </option>
));

interface Props {
  control: Control<ScheduleFormValues>;
  register: UseFormRegister<ScheduleFormValues>;
  error?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: quiet hours as rows of a schedule's settings: one
 * row with its label and an inline Add, then a row per window.
 */
export function QuietHoursEditor({ control, register, error }: Props) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "quietHours",
  });
  const rows = useWatch({ control, name: "quietHours" });

  return (
    <>
      <div className="px-4 py-3">
        <div className="flex min-h-7 items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-sm text-foreground">
            Quiet hours
            <RowHint content={QUIET_HOURS_HINT} label="About quiet hours" />
          </span>
          <RowAddButton
            label="Add quiet hours"
            onClick={() =>
              append({ startTime: "22:00", endTime: "06:00", enabled: true })
            }
          />
        </div>
        {error && (
          <div className="mt-1 flex justify-end">
            <FormError message={error} />
          </div>
        )}
      </div>
      {fields.map((field, idx) => {
        const degenerate =
          rows?.[idx] && rows[idx].startTime === rows[idx].endTime;
        const variant = degenerate
          ? ("invalid" as const)
          : ("standard" as const);
        return (
          <div
            key={field.id}
            className="flex items-center justify-end gap-2 px-4 py-2"
          >
            <RowSelect
              aria-label="Quiet from"
              variant={variant}
              {...register(`quietHours.${idx}.startTime`)}
            >
              {timeOptions}
            </RowSelect>
            <span className="text-sm text-muted-foreground">to</span>
            <RowSelect
              aria-label="Quiet until"
              variant={variant}
              {...register(`quietHours.${idx}.endTime`)}
            >
              {timeOptions}
            </RowSelect>
            <Controller
              control={control}
              name={`quietHours.${idx}.enabled`}
              render={({ field: enabled }) => (
                <Switch
                  checked={enabled.value}
                  onCheckedChange={enabled.onChange}
                  label="Window enabled"
                  className="ml-2"
                />
              )}
            />
            <RemoveButton
              label="Remove quiet hours"
              onClick={() => remove(idx)}
            />
          </div>
        );
      })}
    </>
  );
}
