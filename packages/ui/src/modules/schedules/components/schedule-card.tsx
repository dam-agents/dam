import {
  ChevronDown,
  ChevronRight,
  Close as X,
  Edit as Pencil,
  Time as Clock,
} from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { Schedule, SessionView } from "../../../types.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useToggleSchedule,
} from "../api/mutations.js";
import { rruleToText } from "../domain/rrule-builder.js";
import { ScheduleSessionRow } from "./schedule-session-row.js";

// Render an ISO timestamp as a coarse "in N min / h / d" relative to now.
// Used for surfacing `status.nextRun` in the card header — relative time is
// what users ask about at a glance; the absolute time stays on hover/title.
function relativeFromNow(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `in ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr} h`;
  const d = Math.round(hr / 24);
  return `in ${d} d`;
}

interface Props {
  schedule: Schedule;
  isExpanded: boolean;
  sessions: SessionView[];
  onToggleExpanded: () => void;
  /** Shown only for rrule schedules — legacy cron schedules don't have an
   *  update path in the controller yet, and the editor only builds RRULEs. */
  onEdit?: () => void;
  onResumeSession?: (sessionId: string) => void;
}

export function ScheduleCard({
  schedule,
  isExpanded,
  sessions,
  onToggleExpanded,
  onEdit,
  onResumeSession,
}: Props) {
  const {
    id,
    name,
    type,
    cron,
    rrule,
    timezone,
    quietHours,
    enabled,
    sessionMode,
    createdBy,
    status,
  } = schedule;
  const scheduleSummary =
    type === "rrule" && rrule ? rruleToText(rrule) : (cron ?? "");
  const activeQuietHours = quietHours.filter((q) => q.enabled).length;
  const lastResult = status?.lastResult ?? "";
  const resultClass =
    lastResult === "success" ? "text-success" : "text-destructive";
  const showConfirm = useStore((s) => s.showConfirm);
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();

  const handleToggleEnabled = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSchedule.mutate({ id });
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await showConfirm(`Delete schedule "${name}"?`, "Delete Schedule")) {
      deleteSchedule.mutate({ id });
    }
  };

  const handleResetSession = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      await showConfirm(
        `Reset session for "${name}"? The next tick will start a fresh conversation.`,
        "Reset Session",
      )
    ) {
      resetScheduleSession.mutate({ scheduleId: id });
    }
  };

  return (
    <div className="border-b border-border">
      <div
        className={`flex flex-col gap-1.5 px-4 py-3 cursor-pointer transition-colors hover:bg-muted ${isExpanded ? "bg-muted" : ""}`}
        onClick={onToggleExpanded}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown size={12} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight
              size={12}
              className="text-muted-foreground shrink-0"
            />
          )}
          <span className="text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 bg-info-light text-info border-info">
            {type}
          </span>
          {createdBy === "agent" && (
            <span
              title="Scheduled by the agent itself"
              className="text-[10px] font-bold uppercase tracking-[0.03em] border rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 border-amber-300"
            >
              agent
            </span>
          )}
          {sessionMode === "continuous" && (
            <span className="text-[10px] font-bold uppercase tracking-[0.03em] border rounded-full px-2 py-0.5 bg-purple-50 text-purple-600 border-purple-300">
              continuous
            </span>
          )}
          {activeQuietHours > 0 && (
            <span
              className="text-[10px] font-bold uppercase tracking-[0.03em] border rounded-full px-2 py-0.5 bg-background text-muted-foreground border-border"
              title="Quiet-hours windows silence this schedule"
            >
              🌙 {activeQuietHours}
            </span>
          )}
          <span className="text-[13px] font-semibold text-foreground flex-1 truncate">
            {name}
          </span>
          {enabled && status?.nextRun && (
            <span
              className="text-[11px] font-semibold text-foreground/80 flex items-center gap-1 shrink-0"
              title={`next run: ${new Date(status.nextRun).toLocaleString()}`}
            >
              <Clock size={11} />
              {relativeFromNow(status.nextRun)}
            </span>
          )}
          <span
            className="text-[11px] font-mono text-muted-foreground truncate max-w-[30%]"
            title={scheduleSummary}
          >
            {scheduleSummary}
          </span>
          <button
            className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 ${enabled ? "bg-success-light text-success border-success" : "bg-background text-muted-foreground border-border"} hover:opacity-80`}
            onClick={handleToggleEnabled}
          >
            {enabled ? "On" : "Off"}
          </button>
          {onEdit && type === "rrule" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title="Edit schedule"
            >
              <Pencil size={13} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
          >
            <X size={14} />
          </Button>
        </div>
        {(status || timezone) && (
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground pl-5">
            {timezone && <span>{timezone}</span>}
            {status?.lastRun && (
              <span>last: {new Date(status.lastRun).toLocaleString()}</span>
            )}
            {status?.nextRun && (
              <span>next: {new Date(status.nextRun).toLocaleString()}</span>
            )}
            {lastResult && <span className={resultClass}>{lastResult}</span>}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-border bg-background/50">
          {sessions.length === 0 && (
            <p className="px-4 py-3 text-[11px] text-muted-foreground pl-9">
              No sessions yet
            </p>
          )}
          {sessions.map((session) => (
            <ScheduleSessionRow
              key={session.sessionId}
              session={session}
              onResume={onResumeSession}
            />
          ))}
          {sessionMode === "continuous" && sessions.length > 0 && (
            <div className="px-4 py-2 pl-9">
              <button
                className="text-[10px] font-bold uppercase tracking-[0.03em] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                onClick={handleResetSession}
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
