import {
  ChevronDown,
  ChevronUp,
  Launch,
  OverflowMenuVertical,
  Time,
  WarningAlt,
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
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useRunScheduleNow,
  useToggleSchedule,
} from "../api/mutations.js";
import { useScheduleEditGuard } from "../hooks/use-schedule-edit-guard.js";
import { precheckAlert, scheduleCadenceText } from "../lib/schedule-format.js";
import { ScheduleDetails } from "./schedule-details.js";

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
  const { id, name, enabled, precheck, sessionMode, status } = schedule;
  const showConfirm = useStore((s) => s.showConfirm);
  const sandboxName = useAgentDisplayName(schedule.agentId);
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();
  const runScheduleNow = useRunScheduleNow();

  const guardEdit = useScheduleEditGuard();
  const cadence = scheduleCadenceText(schedule);
  const alert = precheckAlert(schedule);
  const nextRunHint =
    enabled && status?.nextRun ? timeUntil(status.nextRun) : null;

  const handleEdit = () => void guardEdit(schedule, sandboxName, onEdit);

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

  const handleRunNow = async () => {
    const whatHappens = precheck
      ? "The precheck decides it first, just as it would on a scheduled occurrence."
      : "The task runs once, just as it would on a scheduled occurrence.";
    if (
      await showConfirm(
        `Run "${name}" now? ${whatHappens} ${
          enabled
            ? "The next run is not moved."
            : "The schedule stays paused afterwards."
        }`,
        "Run now",
        { confirmLabel: "Run now" },
      )
    )
      runScheduleNow.mutate(
        { id },
        {
          onSuccess: () =>
            emitToast({
              kind: "success",
              message: `Started "${name}" — the run appears under View results.`,
            }),
        },
      );
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
          <p className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
            <span className="truncate">{name}</span>
            {alert && (
              <WarningAlt
                size={16}
                className={cn(
                  "shrink-0",
                  alert.urgent ? "text-destructive" : "text-muted-foreground",
                )}
              >
                <title>{`${alert.text}: ${alert.reason}`}</title>
              </WarningAlt>
            )}
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            {alert && (
              <>
                <span
                  className={cn("truncate", alert.urgent && "text-destructive")}
                >
                  {alert.text}
                </span>
                <span aria-hidden>·</span>
              </>
            )}
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

        <Button variant="outline" size="sm" onClick={onViewResults}>
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
            <DropdownMenuItem onSelect={handleRunNow}>Run now</DropdownMenuItem>
            <DropdownMenuItem onSelect={handleEdit}>
              Edit schedule
            </DropdownMenuItem>
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
