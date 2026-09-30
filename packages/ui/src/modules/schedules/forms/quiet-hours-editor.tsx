import { Add, Close } from "@carbon/icons-react";
import {
  type Control,
  useFieldArray,
  type UseFormRegister,
  useWatch,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import { FormError } from "../../../components/form-error.js";
import { TIME_OPTIONS } from "../lib/schedule-form-options.js";
import type { ScheduleFormValues } from "./schedule-form-schema.js";

interface RowsProps {
  control: Control<ScheduleFormValues>;
  register: UseFormRegister<ScheduleFormValues>;
}

interface EditorProps extends RowsProps {
  error?: string;
}

export function QuietHoursEditor({ control, register, error }: EditorProps) {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Quiet hours</SectionLabel>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        <QuietHoursRows control={control} register={register} />
      </div>
      <FormError message={error} />
    </div>
  );
}

export function QuietHoursRows({ control, register }: RowsProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "quietHours",
  });
  const rows = useWatch({ control, name: "quietHours" });

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="shrink-0 text-[14px] text-foreground">
          Quiet hours
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-2 py-1 text-[14px] text-muted-foreground"
          onClick={() =>
            append({ startTime: "22:00", endTime: "06:00", enabled: true })
          }
        >
          <Add size={16} />
          Add
        </Button>
      </div>

      {fields.map((field, idx) => {
        const row = rows?.[idx];
        const degenerate = row && row.startTime === row.endTime;

        return (
          <div
            key={field.id}
            className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-2 text-[14px]">
              <TimeSelect
                degenerate={degenerate}
                {...register(`quietHours.${idx}.startTime`)}
              />
              <span className="text-muted-foreground">to</span>
              <TimeSelect
                degenerate={degenerate}
                {...register(`quietHours.${idx}.endTime`)}
              />
              {degenerate && (
                <span className="text-[14px] text-destructive">Same time</span>
              )}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => remove(idx)}
            >
              <Close size={16} />
            </Button>
          </div>
        );
      })}
    </>
  );
}

const TimeSelect = ({
  degenerate,
  ...props
}: React.ComponentProps<"select"> & { degenerate?: boolean }) => (
  <select
    className={`h-auto cursor-pointer appearance-none rounded-md border bg-transparent px-2 py-1 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
      degenerate ? "border-destructive" : "border-border"
    }`}
    {...props}
  >
    {TIME_OPTIONS.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);
