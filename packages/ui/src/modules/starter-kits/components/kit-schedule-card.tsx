import { Close, Information, Time, Undo } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  StarterKitSchedule,
  StarterKitScheduleOverride,
} from "api-server-api";
import { rruleToText } from "api-server-api";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { QuietHoursEditor } from "../../schedules/forms/quiet-hours-editor.js";
import {
  ScheduleRecurrenceFields,
  ScheduleSessionTypeField,
} from "../../schedules/forms/schedule-fields.js";
import {
  buildRRuleParts,
  scheduleFormSchema,
  type ScheduleFormValues,
} from "../../schedules/forms/schedule-form-schema.js";
import {
  keepsDeclaredCron,
  keepsDeclaredTiming,
  kitScheduleFormValues,
  kitScheduleModified,
  overrideFromForm,
} from "../lib/kit-schedule-form.js";

interface Props {
  schedule: StarterKitSchedule;
  override: StarterKitScheduleOverride | undefined;
  skipped: boolean;
  onChange: (patch: Omit<StarterKitScheduleOverride, "name">) => void;
  onInvalid: (invalid: boolean) => void;
  onToggleSkipped: () => void;
}

export function KitScheduleCard({
  schedule,
  override,
  skipped,
  onChange,
  onInvalid,
  onToggleSkipped,
}: Props) {
  const enabled = override?.enabled ?? schedule.enabled;
  const [open, setOpen] = useState(false);

  const {
    control,
    register,
    formState: { errors, isValid },
  } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: kitScheduleFormValues(schedule, override),
    mode: "onChange",
  });
  const values = useWatch({ control }) as ScheduleFormValues;
  const serialised = JSON.stringify(values);

  useEffect(() => {
    const patch = overrideFromForm(schedule, values, enabled);
    onInvalid(!isValid || patch === null);
    if (patch) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised, enabled, isValid]);

  const { body } = buildRRuleParts(values);
  const quietHoursError =
    errors.quietHours?.message ?? errors.quietHours?.root?.message;
  const modified = kitScheduleModified(schedule, values, enabled);
  const keepsCron = keepsDeclaredCron(schedule, values);
  const keepsDeclared = keepsDeclaredTiming(schedule, values);

  return (
    <li
      data-testid={`starter-kit-schedule-${schedule.name}`}
      className={cn(
        "rounded-lg border",
        skipped
          ? "border-border bg-muted/30 opacity-70"
          : "border-kit-line bg-kit-surface",
      )}
    >
      <div className="flex items-center gap-4 px-4 py-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            skipped ? "bg-muted text-muted-foreground" : "bg-kit-tint text-kit",
          )}
        >
          <Time size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "text-sm font-semibold",
                skipped
                  ? "text-muted-foreground line-through"
                  : "text-foreground",
              )}
            >
              {schedule.name}
            </span>
            <Badge variant="kit" size="sm">
              Starter Kit
            </Badge>
            {modified && !skipped && (
              <Badge variant="muted" size="sm">
                Modified
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {"cron" in schedule && keepsCron ? (
              <>
                Cron <code className="font-mono">{schedule.cron}</code>
              </>
            ) : "rrule" in schedule && keepsDeclared ? (
              rruleToText(schedule.rrule)
            ) : body ? (
              rruleToText(body)
            ) : (
              "—"
            )}
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={skipped}
          onCheckedChange={(on) => onChange({ enabled: on })}
          aria-label={`Create ${schedule.name} switched on`}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            skipped ? `Add back ${schedule.name}` : `Skip ${schedule.name}`
          }
          title={skipped ? "Add back" : "Skip this schedule"}
          onClick={onToggleSkipped}
        >
          {skipped ? <Undo size={16} /> : <Close size={16} />}
        </Button>
      </div>

      {!skipped && (
        <>
          <div className="border-t border-kit-rule px-4 py-3">
            <div className="flex items-start gap-2.5 rounded-lg bg-kit-tint px-3 py-2.5">
              <Information size={16} className="mt-0.5 shrink-0 text-kit" />
              <p className="text-sm text-foreground/80">{schedule.task}</p>
            </div>
          </div>

          <div className="border-t border-kit-rule px-4 py-2">
            <DisclosureToggle
              open={open}
              onToggle={() => setOpen((o) => !o)}
              chevronSize={14}
              chevronClassName="text-muted-foreground"
              className="text-sm text-muted-foreground hover:text-foreground"
              testId={`starter-kit-schedule-settings-${schedule.name}`}
            >
              Settings
            </DisclosureToggle>
          </div>

          <div
            hidden={!open}
            className="divide-y divide-kit-rule border-t border-kit-rule"
          >
            {"cron" in schedule && (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                Declared as cron{" "}
                <code className="font-mono">{schedule.cron}</code>
                {keepsCron
                  ? " — kept as declared until you change the recurrence below."
                  : " — replaced by the recurrence below."}
              </p>
            )}
            <ScheduleRecurrenceFields
              layout="rows"
              control={control}
              register={register}
              errors={errors}
              values={values}
              accentClassName="bg-kit text-white"
            />
            <ScheduleSessionTypeField
              layout="rows"
              control={control}
              accentClassName="bg-kit text-white"
            />
            <div className="px-4 py-3">
              <QuietHoursEditor
                control={control}
                register={register}
                {...(quietHoursError ? { error: quietHoursError } : {})}
              />
            </div>
          </div>
        </>
      )}
    </li>
  );
}
