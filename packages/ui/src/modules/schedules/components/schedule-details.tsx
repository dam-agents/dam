import { Time } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { formatDateTime, timeUntil } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import type { Schedule } from "../../../types.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useHarnessCatalogModels } from "../../sessions/api/session-pair.js";
import {
  modelGroups,
  modelIndicatorLabel,
} from "../../sessions/lib/catalog-groups.js";
import {
  useHasHarnessDefault,
  useScheduleDefault,
  useSessionModelChoices,
} from "../api/session-model.js";
import {
  clampText,
  declinedSummary,
  formatRunTime,
  runOutcomeLine,
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

export function ScheduleDetails({
  schedule,
  onPickModel,
}: {
  schedule: Schedule;
  onPickModel?: () => void;
}) {
  const { task, precheck, model, timezone, sessionMode, enabled, status } =
    schedule;
  const stopReason = enabled ? status?.stopReason : undefined;
  const nextRun =
    enabled && status?.nextRun
      ? timeUntil(status.nextRun)
      : schedule.type === "once"
        ? "—"
        : stopReason
          ? "Stopped"
          : "Paused";
  const outcome = runOutcomeLine(schedule);
  const declined = precheck ? declinedSummary(status ?? undefined) : null;

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
            <p className="mt-1 text-xs break-all whitespace-pre-wrap text-danger">
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
          {stopReason && (
            <p className="mt-1 text-xs font-normal break-words text-danger">
              {stopReason}
            </p>
          )}
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
            {outcome?.resultText && (
              <span className={cn("break-words", outcome.className)}>
                {outcome.resultText}
              </span>
            )}
          </div>
        </DetailCard>
        <DetailCard label="Timezone">{timezone ?? "—"}</DetailCard>
        {schedule.type !== "once" && (
          <DetailCard label="Session mode">
            <span className="capitalize">{sessionMode ?? "fresh"}</span>
          </DetailCard>
        )}
        {schedule.harness && (
          <DetailCard label="Harness">{schedule.harness}</DetailCard>
        )}
        <DetailCard label="Model">
          <ScheduleModel
            agentId={schedule.agentId}
            harness={schedule.harness}
            model={model}
          />
          {schedule.migrationNote && (
            <p className="mt-1 text-xs font-normal text-warning">
              {schedule.migrationNote}
              {onPickModel && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={onPickModel}
                    className="underline underline-offset-2"
                  >
                    Pick a model
                  </button>
                </>
              )}
            </p>
          )}
        </DetailCard>
        {schedule.settings && Object.keys(schedule.settings).length > 0 && (
          <DetailCard label="Settings">
            {Object.entries(schedule.settings)
              .map(([id, value]) => `${id}: ${value}`)
              .join(" · ")}
          </DetailCard>
        )}
        {schedule.sessionTitle && (
          <DetailCard label="Session title">
            <span className="break-words">{schedule.sessionTitle}</span>
          </DetailCard>
        )}
      </div>
    </div>
  );
}

function ScheduleModel({
  agentId,
  harness,
  model,
}: {
  agentId: string;
  harness: string | null;
  model: string | null;
}) {
  const choices = useSessionModelChoices(agentId);
  const hasDefault = useHasHarnessDefault(agentId);
  const { data: status } = useHarnessConfigStatus(agentId);
  const routed = status?.modelRouter ?? false;
  const { data: catalog } = useHarnessCatalogModels(
    routed ? agentId : null,
    harness ?? status?.defaultHarness ?? null,
  );
  const { data: fallback } = useScheduleDefault(
    routed && !model ? agentId : null,
    harness,
  );
  if (routed) {
    const groups = modelGroups(catalog);
    if (!model)
      return (
        <>
          Scheduled default
          {fallback?.model && (
            <p className="mt-1 text-xs font-normal text-muted-foreground">
              Now: {modelIndicatorLabel(groups, fallback.model)}
            </p>
          )}
        </>
      );
    return <>{modelIndicatorLabel(groups, model)}</>;
  }
  if (!model) return <>{hasDefault ? "Default" : "Same as agent"}</>;
  const choice = choices.find((c) => c.value === model);
  return (
    <>
      {choice?.name ?? model}
      {choice?.description && (
        <p className="mt-1 text-xs font-normal text-muted-foreground">
          {choice.description}
        </p>
      )}
    </>
  );
}
