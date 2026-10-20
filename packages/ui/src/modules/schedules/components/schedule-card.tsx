import { ChevronDown, ChevronUp, Time, WarningAlt } from "@carbon/icons-react";

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
import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import {
  defaultModelScheduleWarning,
  defaultModelStopsRuns,
} from "../../home/lib/default-model-copy.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useRunScheduleNow,
  useToggleSchedule,
} from "../api/mutations.js";
import { useScheduleEditGuard } from "../hooks/use-schedule-edit-guard.js";
import { scheduleOnceState } from "../lib/once-schedule.js";
import {
  cardOutcome,
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
  onViewResults: () => void;
}

export function ScheduleCard({
  schedule,
  isExpanded,
  onToggleExpanded,
  onEdit,
  onViewResults,
}: Props) {
  const { id, name, enabled, sessionMode, status } = schedule;
  const showConfirm = useStore((s) => s.showConfirm);
  const sandboxName = useAgentDisplayName(schedule.agentId);
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();
  const runScheduleNow = useRunScheduleNow();
  const defaultModels = useDefaultModelNotices();

  const guardEdit = useScheduleEditGuard();
  const cadence = scheduleCadenceText(schedule);
  const alert = precheckAlert(schedule);
  const nextRunHint =
    enabled && status?.nextRun ? timeUntil(status.nextRun) : null;
  const stopReason = enabled ? status?.stopReason : undefined;
  const defaultModelNotice = defaultModels.byAgentEvenDismissed.get(
    schedule.agentId,
  );
  const noDefaultModel =
    enabled && !schedule.model && defaultModelStopsRuns(defaultModelNotice);
  const onceState = scheduleOnceState(schedule);
  const outcome = cardOutcome(schedule);

  const handleEdit = () => void guardEdit(schedule, sandboxName, onEdit);

  const handleDelete = async () => {
    if (
      await showConfirm(
        "It stops running and cannot be recovered.",
        `Delete “${name}”?`,
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
            {schedule.migrationNote && (
              <WarningAlt size={16} className="shrink-0 text-warning">
                <title>{schedule.migrationNote}</title>
              </WarningAlt>
            )}
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
            {(schedule.harness || schedule.model) && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">
                  {[schedule.harness, schedule.model]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </>
            )}
            {outcome && (
              <>
                <span aria-hidden>·</span>
                <span
                  className={cn("truncate", outcome.className)}
                  title={outcome.label}
                >
                  {outcome.label}
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
            {noDefaultModel && (
              <>
                <span aria-hidden>·</span>
                <span
                  className="inline-flex items-center gap-1 whitespace-nowrap text-warning"
                  title="The agent has no default model it can run. Set one on its Providers page, or pick a model for this schedule."
                >
                  <WarningAlt size={12} />{" "}
                  {defaultModelNotice &&
                    defaultModelScheduleWarning(defaultModelNotice)}
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
          View results
        </Button>

        {onceState === null && (
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              toggleSchedule.mutate({ id, enabled: checked })
            }
            label="Schedule enabled"
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

      {isExpanded && (
        <ScheduleDetails
          schedule={schedule}
          {...(onceState === null || onceState === "pending"
            ? { onPickModel: handleEdit }
            : {})}
        />
      )}
    </div>
  );
}
