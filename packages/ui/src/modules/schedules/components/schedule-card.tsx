import { ChevronDown, ChevronUp, Time, WarningAlt } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatDateTime, timeUntil } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import type { Schedule } from "../../../types.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import {
  defaultModelScheduleWarning,
  defaultModelStopsRuns,
} from "../../home/lib/default-model-copy.js";
import { useProfiles } from "../../profiles/api/queries.js";
import { StoredPairSummary } from "../../sessions/components/stored-pair-summary.js";
import { useToggleSchedule } from "../api/mutations.js";
import { useScheduleEditGuard } from "../hooks/use-schedule-edit-guard.js";
import { scheduleOnceState } from "../lib/once-schedule.js";
import {
  cardOutcome,
  precheckAlert,
  scheduleCadenceText,
} from "../lib/schedule-format.js";
import { ScheduleActionsMenu } from "./schedule-actions-menu.js";
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
  const { id, name, enabled, status } = schedule;
  const sandboxName = useAgentDisplayName(schedule.agentId);
  const toggleSchedule = useToggleSchedule();
  const defaultModels = useDefaultModelNotices();
  /* UNIT_BOUNDARY_DESCRIPTION: the row names the profile it runs on (D92), so
   * two schedules of one agent that differ only there can be told apart. */
  const { data: profiles = [] } = useProfiles(schedule.agentId);
  const profileName = schedule.profile
    ? (profiles.find((p) => p.id === schedule.profile)?.name ?? "Unavailable")
    : null;

  const guardEdit = useScheduleEditGuard();
  const cadence = scheduleCadenceText(schedule);
  const alert = precheckAlert(schedule);
  const nextRunHint =
    enabled && status?.nextRun ? timeUntil(status.nextRun) : null;
  const stopReason = enabled ? status?.stopReason : undefined;
  const defaultModelNotice = defaultModels.byAgentEvenDismissed
    .get(schedule.agentId)
    ?.find((notice) => notice.kinds.includes("scheduled"));
  const noDefaultModel =
    enabled && !schedule.model && defaultModelStopsRuns(defaultModelNotice);
  const onceState = scheduleOnceState(schedule);
  const outcome = cardOutcome(schedule);

  const handleEdit = () => void guardEdit(schedule, sandboxName, onEdit);

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
          {/* UNIT_BOUNDARY_DESCRIPTION: the line wraps rather than squeezing, so
           * a warning cannot shrink the cadence to one glyph (QA). */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
            {alert && (
              <>
                <span className={cn("truncate", alert.urgent && "text-danger")}>
                  {alert.text}
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            {cadence && <span className="truncate">{cadence}</span>}
            {profileName ? (
              <>
                <span aria-hidden>·</span>
                <span
                  className={cn(
                    "truncate",
                    schedule.profileIssue && "text-warning",
                  )}
                  title={schedule.profileIssue ?? undefined}
                >
                  Runs on {profileName}
                  {schedule.profileIssue ? " · won't run" : ""}
                </span>
              </>
            ) : (
              (schedule.harness || schedule.model) && (
                <>
                  <span aria-hidden>·</span>
                  <span className="flex min-w-0 items-center gap-1">
                    {schedule.harness && schedule.model ? (
                      <StoredPairSummary
                        agentId={schedule.agentId}
                        harness={schedule.harness}
                        model={schedule.model}
                        settings={schedule.settings ?? {}}
                      />
                    ) : (
                      <span className="truncate">
                        {schedule.harness ?? schedule.model}
                      </span>
                    )}
                  </span>
                </>
              )
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
                  title="The agent has no default model it can run. Pick one in a chat's model picker, or give this schedule a profile."
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

        <ScheduleActionsMenu schedule={schedule} onEdit={onEdit} />
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
