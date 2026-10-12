import { Add } from "@carbon/icons-react";
import {
  type Control,
  Controller,
  useFieldArray,
  type UseFormRegister,
  useWatch,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { FormError } from "../../../components/form-error.js";
import { TIME_OPTIONS } from "../lib/schedule-form-options.js";
import type { ScheduleFormValues } from "./schedule-form-schema.js";

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

export function QuietHoursEditor({ control, register, error }: Props) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "quietHours",
  });
  const rows = useWatch({ control, name: "quietHours" });

  const addButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() =>
        append({ startTime: "22:00", endTime: "06:00", enabled: true })
      }
    >
      <Add size={16} /> Add
    </Button>
  );

  return (
    <div className="flex flex-col gap-2">
      {fields.length === 0 ? (
        <>
          <SectionLabel>Quiet hours</SectionLabel>
          <div>{addButton}</div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <SectionLabel>Quiet hours</SectionLabel>
            {addButton}
          </div>
          <p className="text-sm text-muted-foreground">
            Runs inside a window are suppressed; start is inside, end is
            outside.
          </p>
          {fields.map((field, idx) => {
            const degenerate =
              rows?.[idx] && rows[idx].startTime === rows[idx].endTime;
            const variant = degenerate ? ("invalid" as const) : undefined;
            return (
              <div key={field.id} className="flex items-center gap-2">
                <div className="w-[120px]">
                  <Select
                    variant={variant}
                    {...register(`quietHours.${idx}.startTime`)}
                  >
                    {timeOptions}
                  </Select>
                </div>
                <span className="text-sm text-muted-foreground">→</span>
                <div className="w-[120px]">
                  <Select
                    variant={variant}
                    {...register(`quietHours.${idx}.endTime`)}
                  >
                    {timeOptions}
                  </Select>
                </div>
                <Controller
                  control={control}
                  name={`quietHours.${idx}.enabled`}
                  render={({ field: enabled }) => (
                    <Switch
                      checked={enabled.value}
                      onCheckedChange={enabled.onChange}
                      label="Window enabled"
                      className="ml-1"
                    />
                  )}
                />
                <RemoveButton
                  label="Remove quiet hours"
                  onClick={() => remove(idx)}
                  className="ml-auto"
                />
              </div>
            );
          })}
        </>
      )}
      <FormError message={error} />
    </div>
  );
}
