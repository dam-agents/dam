import { Pause, Time } from "@carbon/icons-react";

import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { Schedule } from "../../../../types.js";
import { useToggleSchedule } from "../../../schedules/api/mutations.js";
import { ScheduleActionsMenu } from "../../../schedules/components/schedule-actions-menu.js";
import { scheduleOnceState } from "../../../schedules/lib/once-schedule.js";
import {
  formatRunTime,
  scheduleCadenceText,
} from "../../../schedules/lib/schedule-format.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One schedule in the + menu, as the design draws
 * it: a card with its state icon, its name and cadence with the next run, the
 * switch that pauses or resumes a recurring one, and the ⋮ menu the Schedules
 * section has — Run now, Edit, Reset session, Delete — so a time is changed
 * in its editor rather than by asking the Agent. The editor is the + menu's
 * to open, after it closes. A viewer who may not change schedules sees the
 * card alone.
 */
export function QuickScheduleRow({
  schedule,
  changes,
  onEdit,
}: {
  schedule: Schedule;
  changes: boolean;
  onEdit: () => void;
}) {
  const toggle = useToggleSchedule();
  const { id, name, enabled, status } = schedule;
  const nextRun = enabled && status?.nextRun ? status.nextRun : null;
  const subtitle = [
    scheduleCadenceText(schedule),
    nextRun ? `Next ${formatRunTime(nextRun)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const recurring = scheduleOnceState(schedule) === null;

  return (
    <div
      data-testid="quick-schedule-row"
      className={cn(
        CARD_SURFACE,
        CARD_HOVER,
        "group flex items-center gap-3 rounded-xl px-3 py-2.5",
      )}
    >
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          enabled
            ? "bg-blue-100/50 text-accent dark:bg-blue-950/50"
            : "bg-muted text-muted-foreground",
        )}
      >
        {enabled ? <Time size={16} /> : <Pause size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {changes && (
        <div className="flex shrink-0 items-center gap-1.5">
          {recurring && (
            <Switch
              checked={enabled}
              disabled={toggle.isPending}
              onCheckedChange={(on) => toggle.mutate({ id, enabled: on })}
              label={`${name} schedule enabled`}
            />
          )}
          <ScheduleActionsMenu schedule={schedule} onEdit={onEdit} />
        </div>
      )}
    </div>
  );
}
