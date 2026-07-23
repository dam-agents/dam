import { Time } from "@carbon/icons-react";

import type { Schedule } from "../../../types.js";
import {
  formatRunTime,
  lastRunStatus,
  relativeFromNow,
} from "../lib/schedule-format.js";

function DetailCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <div className="mt-1 text-[13px] font-medium text-foreground">
        {children}
      </div>
    </div>
  );
}

/** The expandable per-schedule detail: the task prompt plus a grid of
 *  operational status. Read-only — editing happens through the modal. */
export function ScheduleDetails({ schedule }: { schedule: Schedule }) {
  const { task, timezone, sessionMode, enabled, status } = schedule;
  const nextRun =
    enabled && status?.nextRun ? relativeFromNow(status.nextRun) : "Paused";
  const lastStatus = lastRunStatus(status?.lastResult);

  return (
    <div className="border-t border-border p-4">
      {task && (
        <>
          <p className="text-[12px] font-medium uppercase tracking-[0.03em] text-muted-foreground">
            Task
          </p>
          <p className="mt-1 mb-4 text-[13px] whitespace-pre-wrap text-foreground">
            {task}
          </p>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <DetailCard label="Next run">
          <span
            className="inline-flex items-center gap-1"
            title={status?.nextRun && new Date(status.nextRun).toLocaleString()}
          >
            <Time size={12} /> {nextRun}
          </span>
        </DetailCard>
        <DetailCard label="Last run">
          {status?.lastRun ? (
            <div className="flex flex-col gap-0.5">
              <span>{formatRunTime(status.lastRun)}</span>
              {lastStatus && (
                <span className={lastStatus.className}>{lastStatus.label}</span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">Never run</span>
          )}
        </DetailCard>
        <DetailCard label="Timezone">{timezone ?? "—"}</DetailCard>
        <DetailCard label="Session mode">
          <span className="capitalize">{sessionMode ?? "fresh"}</span>
        </DetailCard>
      </div>
    </div>
  );
}
