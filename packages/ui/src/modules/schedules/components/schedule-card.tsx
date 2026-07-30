import {
  ChevronDown,
  ChevronUp,
  Launch,
  OverflowMenuVertical,
  Time,
} from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { formatDateTime, timeUntil } from "@/lib/format-time";

import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useToggleSchedule,
} from "../api/mutations.js";
import { scheduleCadenceText } from "../lib/schedule-format.js";
import { ScheduleDetails } from "./schedule-details.js";

const NOT_EDITABLE_HINT =
  "Cron and agent-created schedules can't be edited here.";

interface Props {
  schedule: Schedule;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onViewResults: () => void;
}

export function ScheduleCard({
  schedule,
  isExpanded,
  onToggleExpanded,
  onEdit,
  onViewResults,
}: Props) {
  const { id, name, type, enabled, sessionMode, createdBy, status } = schedule;
  const showConfirm = useStore((s) => s.showConfirm);
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();

  const canEdit = type === "rrule" && createdBy !== "agent";
  const cadence = scheduleCadenceText(schedule);
  const nextRunHint =
    enabled && status?.nextRun ? timeUntil(status.nextRun) : null;

  const handleDelete = async () => {
    if (
      await showConfirm(
        "Are you sure you want to delete this schedule?",
        `Delete ${name}?`,
        { kind: "destructive", confirmLabel: "Delete Schedule" },
      )
    )
      deleteSchedule.mutate({ id });
  };

  const handleReset = async () => {
    if (
      await showConfirm(
        `Reset the session for "${name}"? The next run starts a fresh conversation.`,
        "Reset session",
        { confirmLabel: "Reset session" },
      )
    )
      resetScheduleSession.mutate({ id });
  };

  return (
    <Card>
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">
            {name}
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            {cadence && <span className="truncate">{cadence}</span>}
            {nextRunHint && (
              <>
                <span aria-hidden>·</span>
                <span
                  className="inline-flex items-center gap-1 whitespace-nowrap"
                  title={
                    status?.nextRun &&
                    `Next run: ${formatDateTime(status.nextRun)}`
                  }
                >
                  <Time size={12} /> {nextRunHint}
                </span>
              </>
            )}
          </div>
        </div>

        <Button
          variant="outline"
          className="h-8 px-3 text-sm font-normal"
          onClick={onViewResults}
        >
          <Launch size={14} /> View results
        </Button>

        <Switch
          checked={enabled}
          onCheckedChange={() => toggleSchedule.mutate({ id })}
          label={enabled ? "Disable schedule" : "Enable schedule"}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Schedule actions"
            >
              <OverflowMenuVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {canEdit ? (
              <DropdownMenuItem onSelect={onEdit}>
                Edit schedule
              </DropdownMenuItem>
            ) : (
              <span title={NOT_EDITABLE_HINT}>
                <DropdownMenuItem disabled>Edit schedule</DropdownMenuItem>
              </span>
            )}
            {sessionMode === "continuous" && (
              <DropdownMenuItem onSelect={handleReset}>
                Reset session
              </DropdownMenuItem>
            )}
            <DropdownMenuItem tone="danger" onSelect={handleDelete}>
              Delete schedule
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-1 border-t border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
      >
        {isExpanded ? (
          <>
            Hide details <ChevronUp size={14} />
          </>
        ) : (
          <>
            View details <ChevronDown size={14} />
          </>
        )}
      </button>

      {isExpanded && <ScheduleDetails schedule={schedule} />}
    </Card>
  );
}
