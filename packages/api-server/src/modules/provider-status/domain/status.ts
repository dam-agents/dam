import type { ProviderOutageReason, ProviderStatusView } from "api-server-api";
import {
  nextStreaks,
  signalsOf,
  STATUS_PAGES,
  type SourceReading,
  type SourceStreaks,
} from "./public-signals.js";
import {
  failedAgentsOf,
  hasSucceededCalls,
  isDegraded,
  type WindowBucket,
} from "./window.js";

export interface DegradedTemplate {
  readonly templateId: string;
  readonly reason: ProviderOutageReason;
  readonly since: string;
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
  const answering = (templateId: string) => {
    const buckets = signals.calls.get(templateId);
    return buckets !== undefined && hasSucceededCalls(buckets);
  };
  const publicSignals = signals.readings
    .flatMap((reading) => signalsOf(reading, streaks[reading.source], at))
    .filter(
      (signal) =>
        signal.reason !== "unreachable" || !answering(signal.templateId),
    );
  const firstSince = new Map<string, string>();
  for (const signal of publicSignals)
    if (!firstSince.has(signal.templateId))
      firstSince.set(signal.templateId, signal.since);
  const sinceOf = (templateId: string) =>
    previous?.degraded.find((d) => d.templateId === templateId)?.since ??
    firstSince.get(templateId) ??
    at;
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
        ...d,
        statusPageUrl: STATUS_PAGES[d.templateId] ?? null,
      })),
    checkedAt: snapshot.checkedAt,
  };
}
