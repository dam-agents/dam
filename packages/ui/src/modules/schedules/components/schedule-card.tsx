import {
  ChevronDown,
  ChevronUp,
  Launch,
  Time,
  WarningAlt,
} from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
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
import type { ExactCronConversion } from "../lib/cron-conversion.js";
import { scheduleOnceState } from "../lib/once-schedule.js";
import {
  lastRunStatus,
  precheckAlert,
  runNowConfirmText,
  runNowStartedText,
  scheduleCadenceText,
} from "../lib/schedule-format.js";
import { ScheduleDetails } from "./schedule-details.js";

interface Props {
  schedule: Schedule;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onConvert: (conversion: ExactCronConversion) => void;
  onViewResults: () => void;
}

export function ScheduleCard({
  schedule,
  isExpanded,
  onToggleExpanded,
  onEdit,
  onConvert,
  onViewResults,
}: Props) {
  const { id, name, enabled, sessionMode, status } = schedule;
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
  const stopReason = enabled ? status?.stopReason : undefined;
  const onceState = scheduleOnceState(schedule);
  const onceOutcome =
    onceState && onceState !== "pending"
      ? lastRunStatus(status?.lastResult)
      : null;

  const handleEdit = () =>
    void guardEdit(schedule, sandboxName, { onEdit, onConvert });

  const handleDelete = async () => {
    if (
      await showConfirm(
        "It stops running and cannot be recovered.",
        `Delete ${name}?`,
        { kind: "destructive", confirmLabel: "Delete schedule" },
      )
    )
      deleteSchedule.mutate({ id });
  };

  const handleRunNow = async () => {
    if (
      await showConfirm(runNowConfirmText(schedule), "Run now?", {
        confirmLabel: "Run now",
      })
    )
      runScheduleNow.mutate(
        { id },
        {
          onSuccess: () =>
            emitToast({
              kind: "success",
              message: runNowStartedText(schedule),
            }),
        },
      );
  };

  const handleReset = async () => {
    if (
      await showConfirm(
        `Reset the session for "${name}"? The next run starts a fresh conversation.`,
        "Reset session?",
        { confirmLabel: "Reset session" },
      )
    )
      resetScheduleSession.mutate({ id });
  };

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-md font-medium text-foreground">
            <span className="truncate">{name}</span>
            {alert && (
              <WarningAlt
                size={16}
                className={cn(
                  "shrink-0",
                  alert.urgent ? "text-danger" : "text-muted-foreground",
                )}
              >
                <title>{`${alert.text}: ${alert.reason}`}</title>
              </WarningAlt>
            )}
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            {alert && (
              <>
                <span className={cn("truncate", alert.urgent && "text-danger")}>
                  {alert.text}
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            {cadence && <span className="truncate">{cadence}</span>}
            {onceOutcome && (
              <>
                <span aria-hidden>·</span>
                <span className={cn("truncate", onceOutcome.className)}>
                  {onceOutcome.label}
                </span>
              </>
            )}
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
            {stopReason && (
              <>
                <span aria-hidden>·</span>
                <span
                  className="inline-flex items-center gap-1 whitespace-nowrap text-danger"
                  title={stopReason}
                >
                  <WarningAlt size={12} /> Stopped
                </span>
              </>
            )}
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={onViewResults}>
          <Launch size={14} /> View results
        </Button>

        {onceState === null && (
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              toggleSchedule.mutate({ id, enabled: checked })
            }
            label={enabled ? "Disable schedule" : "Enable schedule"}
          />
        )}

        <RowActionsMenu label="Schedule actions">
          {onceState === null && (
            <DropdownMenuItem onSelect={handleRunNow}>Run now</DropdownMenuItem>
          )}
          {(onceState === null || onceState === "pending") && (
            <DropdownMenuItem onSelect={handleEdit}>
              Edit schedule
            </DropdownMenuItem>
          )}
          {sessionMode === "continuous" && (
            <DropdownMenuItem onSelect={handleReset}>
              Reset session
            </DropdownMenuItem>
          )}
          <DropdownMenuItem tone="danger" onSelect={handleDelete}>
            Delete schedule
          </DropdownMenuItem>
        </RowActionsMenu>
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
    </div>
  );
}
