import { Time } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { formatDateTime, timeUntil } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import type { Schedule } from "../../../types.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useProfiles } from "../../profiles/api/queries.js";
import { StoredPairSummary } from "../../sessions/components/stored-pair-summary.js";
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
  const { data: profiles = [] } = useProfiles(schedule.agentId);
  const routed =
    useHarnessConfigStatus(schedule.agentId).data?.modelRouter ?? false;
  const profileName = schedule.profile
    ? (profiles.find((p) => p.id === schedule.profile)?.name ?? "Unavailable")
    : null;
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
        {profileName && <DetailCard label="Profile">{profileName}</DetailCard>}
        {!routed && schedule.harness && (
          <DetailCard label="Harness">{schedule.harness}</DetailCard>
        )}
        <DetailCard label={routed ? "Runs on" : "Model"}>
          {routed ? (
            <ScheduleRunsOn schedule={schedule} />
          ) : (
            <ScheduleModel agentId={schedule.agentId} model={model} />
          )}
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
        {!routed &&
          schedule.settings &&
          Object.keys(schedule.settings).length > 0 && (
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a routed schedule's fire runs on, in the
 * picker's one summary: the values its profile resolves to or its own, with
 * the subagent slot beside them. A profile that cannot run says so and offers
 * no default, since the fire refuses rather than falling back; only a schedule
 * that names no choice at all follows the agent's chat default.
 */
function ScheduleRunsOn({ schedule }: { schedule: Schedule }) {
  const { data: profiles = [] } = useProfiles(schedule.agentId);
  const follows = !schedule.profile && !schedule.model;
  const { data: fallback } = useScheduleDefault(
    follows ? schedule.agentId : null,
    schedule.harness,
  );
  if (schedule.profileIssue)
    return (
      <span className="text-warning">
        Won&apos;t run: {schedule.profileIssue}
      </span>
    );
  const subagentProfile = profiles.find(
    (p) => p.id === schedule.platformSubagentProfile,
  );
  const subagent = schedule.platformSubagentSettings;
  return (
    <>
      {schedule.harness && schedule.model ? (
        <span className="flex min-w-0 items-center gap-1">
          <StoredPairSummary
            agentId={schedule.agentId}
            harness={schedule.harness}
            model={schedule.model}
            settings={schedule.settings ?? {}}
          />
        </span>
      ) : (
        <>
          The agent&apos;s chat default
          {fallback?.model && (
            <span className="mt-1 flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground">
              Now:
              <StoredPairSummary
                agentId={schedule.agentId}
                harness={fallback.harness}
                model={fallback.model}
                settings={fallback.settings ?? {}}
              />
            </span>
          )}
        </>
      )}
      {(subagentProfile ||
        (subagent?.["platformSubagent.harness"] &&
          subagent["platformSubagent.model"])) && (
        <span className="mt-1 flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground">
          Subagent:
          {subagentProfile ? (
            <span className="truncate">{subagentProfile.name}</span>
          ) : (
            <StoredPairSummary
              agentId={schedule.agentId}
              harness={subagent!["platformSubagent.harness"]!}
              model={subagent!["platformSubagent.model"]!}
              settings={{}}
            />
          )}
        </span>
      )}
    </>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when agents.runtimeFleet.outdated is empty on prod. */
function ScheduleModel({
  agentId,
  model,
}: {
  agentId: string;
  model: string | null;
}) {
  const choices = useSessionModelChoices(agentId);
  const hasDefault = useHasHarnessDefault(agentId);
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
