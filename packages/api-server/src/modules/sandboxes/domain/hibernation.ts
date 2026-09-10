import {
  ACTIVE_SESSION_KEY,
  EXPERIMENT_ACTIVE_KEY,
  LAST_ACTIVITY_KEY,
  STOP_REQUESTED_KEY,
} from "../../agents/infrastructure/labels.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether an agent's sandbox should be running
 * now. Running-versus-hibernated is derived, never stored: activity stamps are
 * the input and this is the only place that reads them, so a wake and a
 * hibernation cannot disagree. A stop request outranks every other signal, and
 * a stamp that cannot be read keeps the agent up — a clock problem must not
 * read as idleness and take working agents down.
 */
export function shouldRun(
  annotations: Record<string, string>,
  idleTimeoutMs: number,
  now: Date,
): boolean {
  if (annotations[STOP_REQUESTED_KEY]) return false;
  if (idleTimeoutMs <= 0) return true;
  if (annotations[ACTIVE_SESSION_KEY] === "true") return true;
  if (annotations[EXPERIMENT_ACTIVE_KEY] === "true") return true;

  const last = annotations[LAST_ACTIVITY_KEY];
  if (!last) return true;
  const lastAt = Date.parse(last);
  if (Number.isNaN(lastAt)) return true;
  return now.getTime() - lastAt <= idleTimeoutMs;
}

export function effectiveIdleTimeoutMs(
  override: string | undefined,
  globalMs: number,
): number {
  if (override === undefined) return globalMs;
  const parsed = parseDuration(override);
  return parsed === null ? globalMs : parsed;
}

function parseDuration(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
  if (!match) return null;
  const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2]!]!;
  return Number(match[1]) * scale;
}
