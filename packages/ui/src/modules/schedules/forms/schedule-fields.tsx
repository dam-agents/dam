import { Information } from "@carbon/icons-react";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { Controller } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HintTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { FormError } from "../../../components/form-error.js";
import { FormField } from "../../../components/form-field.js";
import {
  DAYS_ISO,
  formatTime12,
  RUN_OPTIONS,
  TIME_OPTIONS,
  TIMEZONE_OPTIONS,
} from "../lib/schedule-form-options.js";
import {
  buildRRuleParts,
  type ScheduleFormValues,
} from "./schedule-form-schema.js";

const SESSION_TOOLTIP =
  "Fresh starts a new session each run. Continuous resumes one ongoing session, keeping context across runs.";

export type ScheduleFieldLayout = "stacked" | "rows";

interface FieldsProps {
  layout: ScheduleFieldLayout;
  control: Control<ScheduleFormValues>;
  register: UseFormRegister<ScheduleFormValues>;
  errors: FieldErrors<ScheduleFormValues>;
  values: ScheduleFormValues;
  accentClassName?: string;
}

const DEFAULT_ACCENT = "bg-primary text-primary-foreground";

function Field({
  layout,
  label,
  hint,
  error,
  children,
}: {
  layout: ScheduleFieldLayout;
  label: string;
  hint?: React.ReactNode;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  if (layout === "rows")
    return (
      <div className="px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          <span className="flex shrink-0 items-center gap-1.5 text-sm text-foreground">
            {label}
            {hint}
          </span>
          <div className="w-[260px] shrink-0">{children}</div>
        </div>
        {error && (
          <div className="mt-1 flex justify-end">
            <FormError message={error} />
          </div>
        )}
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <SectionLabel>{label}</SectionLabel>
        {hint}
      </div>
      {children}
      <FormError message={error} />
    </div>
  );
}

function Chip({
  selected,
  accentClassName,
  compact,
  onClick,
  children,
}: {
  selected: boolean;
  accentClassName: string;
  compact: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full text-xs font-medium",
        compact ? "px-2 py-0.5" : "px-3 py-1",
        selected ? accentClassName : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ScheduleRecurrenceFields({
  layout,
  control,
  register,
  errors,
  values,
  accentClassName = DEFAULT_ACCENT,
}: FieldsProps) {
  const rows = layout === "rows";
  const selectProps = rows
    ? ({ variant: "ghost", size: "sm" } as const)
    : ({ className: "h-10" } as const);
  const cadence = buildRRuleParts(values);

  const timeOptions = TIME_OPTIONS.some((o) => o.value === values.time)
    ? TIME_OPTIONS
    : [
        { value: values.time, label: formatTime12(values.time) },
        ...TIME_OPTIONS,
      ];

  return (
    <>
      <Field layout={layout} label="Repeat">
        <Select {...selectProps} {...register("kind")}>
          {RUN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {values.kind === "daily" && (
        <Field layout={layout} label="Time">
          <Select {...selectProps} {...register("time")}>
            {timeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {(values.kind === "minutely" || values.kind === "hourly") && (
        <Field
          layout={layout}
          label="Every"
          {...(errors.interval?.message
            ? { error: errors.interval.message }
            : {})}
        >
          <div
            className={cn(
              "flex items-center gap-2 text-sm text-foreground",
              rows && "justify-end",
            )}
          >
            <Input
              type="number"
              min={1}
              className={cn("w-[80px]", rows ? "h-8" : "h-10")}
              variant={errors.interval ? "invalid" : undefined}
              {...register("interval")}
            />
            <span>{values.kind === "minutely" ? "minutes" : "hours"}</span>
          </div>
        </Field>
      )}

      {values.kind !== "custom" && (
        <Field
          layout={layout}
          label="Days"
          {...(errors.days?.message ? { error: errors.days.message } : {})}
        >
          <Controller
            control={control}
            name="days"
            render={({ field }) => (
              <div
                className={cn(
                  "flex flex-wrap gap-1.5",
                  rows && "justify-end gap-1",
                )}
              >
                {DAYS_ISO.map((d) => (
                  <Chip
                    key={d.iso}
                    selected={field.value.includes(d.iso)}
                    accentClassName={accentClassName}
                    compact={rows}
                    onClick={() =>
                      field.onChange(
                        field.value.includes(d.iso)
                          ? field.value.filter((v) => v !== d.iso)
                          : [...field.value, d.iso].sort(),
                      )
                    }
                  >
                    {d.label}
                  </Chip>
                ))}
              </div>
            )}
          />
        </Field>
      )}

      {values.kind === "custom" && (
        <Field
          layout={layout}
          label="RRULE"
          {...(cadence.error ? { error: cadence.error } : {})}
        >
          <Input
            className={cn("font-mono text-xs", rows ? "h-8" : "h-10")}
            variant={cadence.error ? "invalid" : undefined}
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30"
            {...register("customRRule")}
          />
        </Field>
      )}

      {cadence.error
        ? values.kind !== "custom" && <FormError message={cadence.error} />
        : !rows &&
          cadence.summary && (
            <p className="-mt-1 text-sm text-muted-foreground">
              {cadence.summary}
            </p>
          )}

      <Field
        layout={layout}
        label="Timezone"
        {...(errors.timezone?.message
          ? { error: errors.timezone.message }
          : {})}
      >
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
              {...(rows
                ? {
                    className:
                      "h-8 border-transparent bg-transparent text-xs hover:border-input hover:bg-background",
                  }
                : {})}
            />
          )}
        />
      </Field>
    </>
  );
}

export function ScheduleSessionTypeField({
  layout,
  control,
  accentClassName = DEFAULT_ACCENT,
}: {
  layout: ScheduleFieldLayout;
  control: Control<ScheduleFormValues>;
  accentClassName?: string;
}) {
  return (
    <Field
      layout={layout}
      label="Session type"
      hint={
        <HintTooltip
          content={SESSION_TOOLTIP}
          label="About session types"
          side="top"
          className="text-muted-foreground"
        >
          <Information size={14} />
        </HintTooltip>
      }
    >
      <Controller
        control={control}
        name="sessionMode"
        render={({ field }) => (
          <div
            className={cn("flex gap-1.5", layout === "rows" && "justify-end")}
          >
            {(["fresh", "continuous"] as const).map((mode) => (
              <Chip
                key={mode}
                selected={field.value === mode}
                accentClassName={accentClassName}
                compact={false}
                onClick={() => field.onChange(mode)}
              >
                <span className="capitalize">{mode}</span>
              </Chip>
            ))}
          </div>
        )}
      />
    </Field>
  );
}

export const PRECHECK_HINT =
  "A shell command run before each fire, from the agent's workspace root (/home/agent/work) — so a script in a repo cloned there is ./<repo>/scripts/check.sh. Exit 0 runs the task, exit 1 skips this occurrence without waking a model, and any other exit means the check itself broke — the task runs anyway. Whatever it prints is appended to the prompt.";

const PRECHECK_PLACEHOLDER =
  "git fetch -q && git log --oneline HEAD..origin/main | grep -q .";

export function SchedulePrecheckField({
  layout,
  register,
  errors,
}: {
  layout: ScheduleFieldLayout;
  register: UseFormRegister<ScheduleFormValues>;
  errors: FieldErrors<ScheduleFormValues>;
}) {
  const input = (
    <Textarea
      className="min-h-[56px] resize-y font-mono text-xs"
      variant={errors.precheck ? "invalid" : undefined}
      placeholder={PRECHECK_PLACEHOLDER}
      rows={2}
      {...register("precheck")}
    />
  );

  if (layout === "stacked")
    return (
      <FormField
        label="Precheck (optional)"
        error={errors.precheck?.message}
        hint={PRECHECK_HINT}
        disableInset
      >
        {input}
      </FormField>
    );

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <SectionLabel>Precheck (optional)</SectionLabel>
        <HintTooltip
          content={PRECHECK_HINT}
          label="About prechecks"
          side="top"
          className="text-muted-foreground"
        >
          <Information size={14} />
        </HintTooltip>
      </div>
      {input}
      <FormError message={errors.precheck?.message} />
    </div>
  );
}
