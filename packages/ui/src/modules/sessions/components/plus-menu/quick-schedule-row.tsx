import { ToggleRow } from "@/components/ui/toggle-row";

import type { Schedule } from "../../../../types.js";
import { useToggleSchedule } from "../../../schedules/api/mutations.js";
import { scheduleOnceState } from "../../../schedules/lib/once-schedule.js";
import {
  formatRunTime,
  scheduleCadenceText,
} from "../../../schedules/lib/schedule-format.js";

export function QuickScheduleRow({
  schedule,
  changes,
}: {
  schedule: Schedule;
  changes: boolean;
}) {
  const toggle = useToggleSchedule();
  const { id, name, enabled, status } = schedule;
  const nextRun = enabled && status?.nextRun ? status.nextRun : null;
  const description = [
    scheduleCadenceText(schedule),
    nextRun ? `Next ${formatRunTime(nextRun)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (scheduleOnceState(schedule) !== null || !changes)
    return <ToggleRow title={name} description={description} control={null} />;
  return (
    <ToggleRow
      title={name}
      description={description}
      label={`${name} schedule enabled`}
      checked={enabled}
      disabled={toggle.isPending}
      onCheckedChange={(on) => toggle.mutate({ id, enabled: on })}
    />
  );
}
