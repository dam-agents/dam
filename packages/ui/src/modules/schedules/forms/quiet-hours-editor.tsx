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
import {
  RowAddButton,
  RowHint,
  RowNote,
  RowSelect,
} from "./schedule-fields.js";
import type { ScheduleFormValues } from "./schedule-form-schema.js";

const QUIET_HOURS_NOTE = "Runs inside a window are skipped.";

const QUIET_HOURS_HINT =
  "Runs inside a window are suppressed, not moved: start is inside the window, end is outside. A window that is off keeps its times but suppresses nothing.";

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
        <RowNote>{QUIET_HOURS_NOTE}</RowNote>
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
        const window = `Quiet hours window ${idx + 1}`;
        return (
          <div
            key={field.id}
            role="group"
            aria-label={window}
            className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 bg-muted/30 px-4 py-2 text-sm"
          >
            <span className="text-muted-foreground">From</span>
            <RowSelect
              aria-label={`${window}: from`}
              variant={variant}
              {...register(`quietHours.${idx}.startTime`)}
            >
              {timeOptions}
            </RowSelect>
            <span className="text-muted-foreground">to</span>
            <RowSelect
              aria-label={`${window}: to`}
              variant={variant}
              {...register(`quietHours.${idx}.endTime`)}
            >
              {timeOptions}
            </RowSelect>
            <Controller
              control={control}
              name={`quietHours.${idx}.enabled`}
              render={({ field: enabled }) => (
                <label className="ml-2 flex items-center gap-2 text-muted-foreground">
                  <Switch
                    checked={enabled.value}
                    onCheckedChange={enabled.onChange}
                    label={`${window}: on`}
                  />
                  <span className="w-6">{enabled.value ? "On" : "Off"}</span>
                </label>
              )}
            />
            <RemoveButton
              label={`Remove quiet hours window ${idx + 1}`}
              tooltip="Remove window"
              onClick={() => remove(idx)}
              className="ml-1"
            />
          </div>
        );
      })}
    </>
  );
}
