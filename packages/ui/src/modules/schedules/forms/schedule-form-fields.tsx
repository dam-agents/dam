import { Information } from "@carbon/icons-react";
import {
  type Control,
  Controller,
  type FieldErrors,
  type UseFormRegister,
  type UseFormWatch,
} from "react-hook-form";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HintTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { FormError } from "../../../components/form-error.js";
import {
  formatTime12,
  RUN_OPTIONS,
  TIME_OPTIONS,
  TIMEZONE_OPTIONS,
} from "../lib/schedule-form-options.js";
import { QuietHoursEditor } from "./quiet-hours-editor.js";
import {
  buildRRuleParts,
  type ScheduleFormValues,
} from "./schedule-form-schema.js";

const DAYS_ISO: { iso: number; label: string }[] = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
];

const SESSION_TOOLTIP =
  "Fresh starts a new session each run. Continuous resumes one ongoing session, keeping context across runs.";

interface Props {
  control: Control<ScheduleFormValues>;
  register: UseFormRegister<ScheduleFormValues>;
  watch: UseFormWatch<ScheduleFormValues>;
  errors: FieldErrors<ScheduleFormValues>;
}

export function ScheduleFormFields({
  control,
  register,
  watch,
  errors,
}: Props) {
  const values = watch();
  const cadence = buildRRuleParts(values);

  const timeOptions = TIME_OPTIONS.some((o) => o.value === values.time)
    ? TIME_OPTIONS
    : [
        { value: values.time, label: formatTime12(values.time) },
        ...TIME_OPTIONS,
      ];

  const quietHoursError =
    errors.quietHours?.message ?? errors.quietHours?.root?.message;

  return (
    <>
      <FormField label="Name" error={errors.name?.message} disableInset>
        <Input
          className="h-10"
          variant={errors.name ? "invalid" : undefined}
          placeholder={`eg. "Daily brief"`}
          {...register("name")}
        />
      </FormField>

      <div className="flex flex-col gap-2">
        <SectionLabel>Run</SectionLabel>
        <Select className="h-10" {...register("kind")}>
          {RUN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {values.kind === "daily" && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Time</SectionLabel>
          <Select className="h-10" {...register("time")}>
            {timeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {(values.kind === "minutely" || values.kind === "hourly") && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span>Every</span>
            <Input
              type="number"
              min={1}
              className="h-10 w-[80px]"
              variant={errors.interval ? "invalid" : undefined}
              {...register("interval")}
            />
            <span>{values.kind === "minutely" ? "minutes" : "hours"}</span>
          </div>
          <FormError message={errors.interval?.message} />
        </div>
      )}

      {values.kind !== "custom" && (
        <div className="flex flex-col gap-2">
          <SectionLabel>On</SectionLabel>
          <Controller
            control={control}
            name="days"
            render={({ field }) => (
              <div className="flex flex-wrap gap-1.5">
                {DAYS_ISO.map((d) => (
                  <button
                    key={d.iso}
                    type="button"
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium",
                      field.value.includes(d.iso)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                    onClick={() =>
                      field.onChange(
                        field.value.includes(d.iso)
                          ? field.value.filter((v) => v !== d.iso)
                          : [...field.value, d.iso].sort(),
                      )
                    }
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          />
          <FormError message={errors.days?.message} />
        </div>
      )}

      {values.kind === "custom" && (
        <div className="flex flex-col gap-2">
          <SectionLabel>RRULE</SectionLabel>
          <Input
            className="h-10 font-mono text-sm"
            variant={cadence.error ? "invalid" : undefined}
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30"
            {...register("customRRule")}
          />
        </div>
      )}

      {cadence.error ? (
        <FormError message={cadence.error} />
      ) : (
        cadence.summary && (
          <p className="-mt-1 text-sm text-muted-foreground">
            {cadence.summary}
          </p>
        )
      )}

      <FormField label="Timezone" error={errors.timezone?.message} disableInset>
        <Controller
          control={control}
          name="timezone"
          render={({ field }) => (
            <SearchableSelect
              value={field.value}
              onChange={field.onChange}
              options={TIMEZONE_OPTIONS}
              placeholder="Select a timezone"
              invalid={!!errors.timezone}
            />
          )}
        />
      </FormField>

      <QuietHoursEditor
        control={control}
        register={register}
        error={quietHoursError}
      />

      <FormField label="Prompt" error={errors.task?.message} disableInset>
        <Textarea
          className="min-h-[80px] resize-y"
          variant={errors.task ? "invalid" : undefined}
          placeholder="Enter a task prompt"
          rows={3}
          {...register("task")}
        />
      </FormField>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <SectionLabel>Session type</SectionLabel>
          <HintTooltip
            content={SESSION_TOOLTIP}
            label="About session types"
            side="top"
            className="text-muted-foreground"
          >
            <Information size={16} />
          </HintTooltip>
        </div>
        <Controller
          control={control}
          name="sessionMode"
          render={({ field }) => (
            <div className="flex gap-1.5">
              {(["fresh", "continuous"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    "rounded-full px-3 py-1 text-sm font-medium capitalize",
                    field.value === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                  onClick={() => field.onChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}
        />
      </div>
    </>
  );
}
