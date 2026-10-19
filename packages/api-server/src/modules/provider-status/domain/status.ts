import type { ProviderOutageReason, ProviderStatusView } from "api-server-api";
import { isDegraded, type WindowBucket } from "./window.js";

export interface DegradedTemplate {
  readonly templateId: string;
  readonly reason: ProviderOutageReason;
  readonly since: string;
}

export interface StatusSnapshot {
  readonly checkedAt: string;
  readonly degraded: readonly DegradedTemplate[];
  readonly damSide: { readonly since: string } | null;
}

export interface StatusSignals {
  readonly calls: ReadonlyMap<string, readonly WindowBucket[]>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one evaluation of Provider Status. A template is
 * degraded when its gateway calls of the last five minutes meet the rule of
 * `isDegraded`, and it keeps the `since` of the previous snapshot while it
 * stays degraded. When at least two templates had calls and all of them are
 * degraded, the cause is on the platform's side: the providers are not
 * blamed, but each keeps its own `since` for when the platform recovers first.
 */
export function nextSnapshot(
  previous: StatusSnapshot | null,
  signals: StatusSignals,
  now: Date,
): StatusSnapshot {
  const at = now.toISOString();
  const sinceOf = (templateId: string) =>
    previous?.degraded.find((d) => d.templateId === templateId)?.since ?? at;
  const failing = [...signals.calls]
    .filter(([, buckets]) => isDegraded(buckets))
    .map(([templateId]) => templateId)
    .sort();
  const damSide =
    signals.calls.size >= 2 && failing.length === signals.calls.size;
  return {
    checkedAt: at,
    degraded: failing.map((templateId) => ({
      templateId,
      reason: "failing-calls",
      since: sinceOf(templateId),
    })),
    damSide: damSide ? { since: previous?.damSide?.since ?? at } : null,
  };
}

export function statusView(
  snapshot: StatusSnapshot | null,
): ProviderStatusView {
  if (!snapshot) return { damSide: null, outages: [], checkedAt: null };
  return {
    damSide: snapshot.damSide,
    outages: snapshot.damSide
      ? []
      : snapshot.degraded.map((d) => ({ ...d, statusPageUrl: null })),
    checkedAt: snapshot.checkedAt,
  };
}
