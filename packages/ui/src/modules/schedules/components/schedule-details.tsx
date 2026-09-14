import { Time } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { formatDateTime, timeUntil } from "@/lib/format-time";

import type { Schedule } from "../../../types.js";
import {
  clampText,
  declinedSummary,
  formatRunTime,
  lastRunStatus,
} from "../lib/schedule-format.js";

function DetailCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Callout size="sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium text-foreground">{children}</div>
    </Callout>
  );
}

export function ScheduleDetails({ schedule }: { schedule: Schedule }) {
  const { task, precheck, timezone, sessionMode, enabled, status } = schedule;
  const nextRun =
    enabled && status?.nextRun ? timeUntil(status.nextRun) : "Paused";
  const lastStatus = lastRunStatus(status?.lastResult);
  const declined = declinedSummary(status ?? undefined);

  return (
    <div className="border-t border-border p-4">
      {task && (
        <>
          <SectionLabel>Task</SectionLabel>
          <p className="mt-1 mb-4 text-sm whitespace-pre-wrap text-foreground">
            {task}
          </p>
        </>
      )}
      {precheck && (
        <>
          <SectionLabel>Precheck</SectionLabel>
          <p className="mt-1 mb-1 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
            {precheck}
          </p>
          {status?.lastPrecheckError && (
            <p className="mt-1 text-xs break-all whitespace-pre-wrap text-destructive">
              {(status.precheckFailedCount ?? 0) > 1
                ? `Precheck failed ${status.precheckFailedCount} times in a row — ran anyway: `
                : "Precheck failed — ran anyway: "}
              {clampText(status.lastPrecheckError)}
            </p>
          )}
          <div className="mb-4" />
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <DetailCard label="Next run">
          <span
            className="inline-flex items-center gap-1"
            title={status?.nextRun && formatDateTime(status.nextRun)}
          >
            <Time size={12} /> {nextRun}
          </span>
        </DetailCard>
        <DetailCard label="Last run">
          <div className="flex flex-col gap-0.5">
            {declined && <span>{declined}</span>}
            {status?.lastRun ? (
              <span className={declined ? "text-muted-foreground" : undefined}>
                {declined
                  ? `(last ran ${formatRunTime(status.lastRun)})`
                  : formatRunTime(status.lastRun)}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {declined ? "(never ran)" : "Never run"}
              </span>
            )}
            {lastStatus && (
              <span className={lastStatus.className}>{lastStatus.label}</span>
            )}
          </div>
        </DetailCard>
        <DetailCard label="Timezone">{timezone ?? "—"}</DetailCard>
        <DetailCard label="Session mode">
          <span className="capitalize">{sessionMode ?? "fresh"}</span>
        </DetailCard>
      </div>
    </div>
  );
}
