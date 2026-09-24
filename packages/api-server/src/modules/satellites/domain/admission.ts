import { formatJobRef, type SatelliteTool } from "api-server-api";
import type { SatelliteRow } from "./types.js";

export const OFFLINE_AFTER_MS = 90_000;

export function jobCount(n: number): string {
  return n === 1 ? "1 job" : `${n} jobs`;
}

export function isOnline(satellite: SatelliteRow, now: Date): boolean {
  if (satellite.lastSeenAt === null) return false;
  return now.getTime() - satellite.lastSeenAt.getTime() < OFFLINE_AFTER_MS;
}

export type Admission =
  | { ok: true; tool: SatelliteTool; toolMax: number | null }
  | { ok: false; reason: string };

export interface ActiveCounts {
  total: number;
  byTool: Map<string, number>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a tool call may become a Job. The platform
 * decides only what it can know from the Snapshot — that the machine is there,
 * is not shutting down, offers this tool and has room for another call. What the
 * arguments mean, and whether this particular call needs a human, is the
 * machine's own question, answered when it picks the work up.
 */
export function admit(
  satellite: SatelliteRow,
  tool: string,
  active: ActiveCounts,
  now: Date,
): Admission {
  if (!isOnline(satellite, now))
    return {
      ok: false,
      reason:
        satellite.lastSeenAt === null
          ? `${satellite.name} has never connected`
          : `${satellite.name} is offline (last seen ${describeAge(now.getTime() - satellite.lastSeenAt.getTime())} ago)`,
    };
  if (satellite.draining)
    return { ok: false, reason: `${satellite.name} is shutting down` };

  const entry = satellite.tools.find((candidate) => candidate.name === tool);
  if (entry === undefined)
    return {
      ok: false,
      reason:
        satellite.tools.length === 0
          ? `${satellite.name} offers no tools`
          : `${satellite.name} has no tool called "${tool}" — it offers ${satellite.tools.map((t) => t.name).join(", ")}`,
    };

  if (active.total >= satellite.maxConcurrent)
    return {
      ok: false,
      reason: `${satellite.name} is running ${jobCount(active.total)} (max ${satellite.maxConcurrent}) — wait for one to finish`,
    };

  const perTool = entry.maxConcurrent;
  if (perTool !== undefined) {
    const running = active.byTool.get(entry.name) ?? 0;
    if (running >= perTool)
      return {
        ok: false,
        reason: `${entry.name} already has ${running} running (max ${perTool}) — wait for one to finish`,
      };
  }

  return { ok: true, tool: entry, toolMax: perTool ?? null };
}

function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

export { formatJobRef };
