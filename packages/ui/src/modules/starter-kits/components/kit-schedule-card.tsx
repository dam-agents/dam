import { Close, Information, Time, Undo } from "@carbon/icons-react";
import type {
  StarterKitSchedule,
  StarterKitScheduleOverride,
} from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { describeTiming, effectiveTiming } from "../lib/setup.js";

interface Props {
  schedule: StarterKitSchedule;
  override: StarterKitScheduleOverride | undefined;
  skipped: boolean;
  onChange: (patch: Omit<StarterKitScheduleOverride, "name">) => void;
  onToggleSkipped: () => void;
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-kit-rule px-4 py-2.5 last:border-b-0">
      <span className="shrink-0 text-sm text-foreground">{label}</span>
      <div className="w-[260px] shrink-0">{children}</div>
    </div>
  );
}

export function KitScheduleCard({
  schedule,
  override,
  skipped,
  onChange,
  onToggleSkipped,
}: Props) {
  const timing = effectiveTiming(schedule, override);
  const enabled = override?.enabled ?? schedule.enabled;
  const sessionMode = override?.sessionMode ?? schedule.sessionMode ?? "fresh";
  const isCron = "cron" in timing;

  return (
    <li
      data-testid={`starter-kit-schedule-${schedule.name}`}
      className={cn(
        "overflow-hidden rounded-lg border",
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
            {skipped && (
              <Badge variant="muted" size="sm">
                skipped
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {describeTiming(timing)}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--c-kit)]"
            checked={enabled}
            disabled={skipped}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            aria-label={`Create ${schedule.name} switched on`}
          />
          On
        </label>
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

          <div className="border-t border-kit-rule">
            <FieldRow label="Repeat">
              <Select
                className="h-9"
                value={isCron ? "cron" : "rrule"}
                onChange={(e) =>
                  onChange({
                    timing:
                      e.target.value === "cron"
                        ? { cron: "0 9 * * 1-5" }
                        : {
                            rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
                            timezone:
                              Intl.DateTimeFormat().resolvedOptions().timeZone,
                          },
                  })
                }
                aria-label={`How ${schedule.name} repeats`}
              >
                <option value="cron">Cron (UTC)</option>
                <option value="rrule">Custom (RRULE)</option>
              </Select>
            </FieldRow>

            <FieldRow label={isCron ? "Cron" : "RRULE"}>
              <Input
                className="h-9 font-mono"
                value={isCron ? timing.cron : timing.rrule}
                onChange={(e) =>
                  onChange({
                    timing: isCron
                      ? { cron: e.target.value }
                      : { rrule: e.target.value, timezone: timing.timezone },
                  })
                }
                aria-label={`${schedule.name} ${isCron ? "cron" : "rrule"} expression`}
              />
            </FieldRow>

            {!isCron && (
              <FieldRow label="Timezone">
                <Input
                  className="h-9"
                  value={timing.timezone}
                  onChange={(e) =>
                    onChange({
                      timing: { rrule: timing.rrule, timezone: e.target.value },
                    })
                  }
                  aria-label={`${schedule.name} timezone`}
                />
              </FieldRow>
            )}

            <FieldRow label="Session type">
              <Select
                className="h-9"
                value={sessionMode}
                onChange={(e) =>
                  onChange({
                    sessionMode: e.target.value as "continuous" | "fresh",
                  })
                }
                aria-label={`${schedule.name} session type`}
              >
                <option value="fresh">Fresh</option>
                <option value="continuous">Continuous</option>
              </Select>
            </FieldRow>
          </div>
        </>
      )}
    </li>
  );
}
