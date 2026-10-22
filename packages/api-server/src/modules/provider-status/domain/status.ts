import type { ProviderOutageReason, ProviderStatusView } from "api-server-api";
import {
  clearedTemplates,
  nextStreaks,
  signalsOf,
  STATUS_PAGES,
  type SourceReading,
  type SourceStreaks,
} from "./public-signals.js";
import {
  answeringTemplates,
  failedAgentsOf,
  isDegraded,
  type WindowBucket,
} from "./window.js";

export interface DegradedTemplate {
  readonly templateId: string;
  readonly reason: ProviderOutageReason;
  readonly since: string;
  readonly failedPayers: readonly string[];
}

export interface StatusSnapshot {
  readonly checkedAt: string;
  readonly degraded: readonly DegradedTemplate[];
  readonly damSide: { readonly since: string } | null;
  readonly streaks: SourceStreaks;
}

export interface StatusSignals {
  readonly calls: ReadonlyMap<string, readonly WindowBucket[]>;
  readonly readings: readonly SourceReading[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one evaluation of Provider Status. A template is
 * degraded when its gateway calls of the last five minutes meet the rule of
 * `isDegraded`, or when a public source reports it; the gateway's reason
 * wins. A proxy that the api-server cannot reach is not blamed while the
 * agents' own calls to it still succeed, because their path can differ. It
 * keeps the `since` of the previous snapshot while it stays degraded. When
 * at least two templates had calls, the calls of all of them fail, and at
 * least two agents failed, the cause is on the platform's side: those
 * providers are not blamed, but each keeps its own `since` for when the
 * platform recovers first. A public source never makes that state.
 */
export function nextSnapshot(
  previous: StatusSnapshot | null,
  signals: StatusSignals,
  now: Date,
): StatusSnapshot {
  const at = now.toISOString();
  const streaks = nextStreaks(previous?.streaks ?? {}, signals.readings, at);
  const answering = new Set(answeringTemplates(signals.calls));
  const publicSignals = signals.readings
    .flatMap((reading) => signalsOf(reading, streaks[reading.source], at))
    .filter(
      (signal) =>
        signal.reason !== "unreachable" || !answering.has(signal.templateId),
    );
  const firstSince = new Map<string, string>();
  for (const signal of publicSignals)
    if (!firstSince.has(signal.templateId))
      firstSince.set(signal.templateId, signal.since);
  const previousOf = (templateId: string) =>
    previous?.degraded.find((d) => d.templateId === templateId);
  const sinceOf = (templateId: string) =>
    previousOf(templateId)?.since ?? firstSince.get(templateId) ?? at;
  const failedPayersOf = (templateId: string) =>
    [
      ...new Set([
        ...(previousOf(templateId)?.failedPayers ?? []),
        ...failedAgentsOf(signals.calls.get(templateId) ?? []),
      ]),
    ].sort();
  const failing = new Set(
    [...signals.calls]
      .filter(([, buckets]) => isDegraded(buckets))
      .map(([templateId]) => templateId),
  );
  const reasons = new Map<string, ProviderOutageReason>();
  for (const signal of publicSignals)
    if (!reasons.has(signal.templateId))
      reasons.set(signal.templateId, signal.reason);
  for (const templateId of failing) reasons.set(templateId, "failing-calls");
  const failedAgents = failedAgentsOf([...signals.calls.values()].flat());
  const damSide =
    signals.calls.size >= 2 &&
    failing.size === signals.calls.size &&
    failedAgents.size >= 2;
  return {
    checkedAt: at,
    degraded: [...reasons]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([templateId, reason]) => ({
        templateId,
        reason,
        since: sinceOf(templateId),
        failedPayers: failedPayersOf(templateId),
      })),
    damSide: damSide ? { since: previous?.damSide?.since ?? at } : null,
    streaks,
  };
}

export function statusView(
  snapshot: StatusSnapshot | null,
): ProviderStatusView {
  if (!snapshot) return { damSide: null, outages: [], checkedAt: null };
  return {
    damSide: snapshot.damSide,
    outages: snapshot.degraded
      .filter((d) => !(snapshot.damSide && d.reason === "failing-calls"))
      .map((d) => ({
        templateId: d.templateId,
        reason: d.reason,
        since: d.since,
        statusPageUrl: STATUS_PAGES[d.templateId] ?? null,
      })),
    checkedAt: snapshot.checkedAt,
  };
}

export interface EvaluatedOutage {
  readonly templateId: string;
  readonly reason: ProviderOutageReason;
  readonly since: Date;
  readonly statusPageUrl: string | null;
  readonly failedPayers: readonly string[];
}

export interface Evaluation {
  readonly outages: readonly EvaluatedOutage[];
  readonly damSide: { readonly since: Date } | null;
  readonly answering: readonly string[];
  readonly cleared: readonly string[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the state that one evaluation hands to the
 * outage alerts. Unlike the status query, it lists every degraded template,
 * also while the fault is on the platform's side, with its failed payers.
 * `answering` and `cleared` are the evidence that a template works again.
 */
export function evaluationOf(
  snapshot: StatusSnapshot,
  signals: StatusSignals,
): Evaluation {
  return {
    outages: snapshot.degraded.map((d) => ({
      templateId: d.templateId,
      reason: d.reason,
      since: new Date(d.since),
      statusPageUrl: STATUS_PAGES[d.templateId] ?? null,
      failedPayers: d.failedPayers,
    })),
    damSide: snapshot.damSide && { since: new Date(snapshot.damSide.since) },
    answering: answeringTemplates(signals.calls),
    cleared: clearedTemplates(signals.readings, snapshot.checkedAt),
  };
}
