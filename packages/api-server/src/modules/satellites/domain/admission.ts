import {
  countTokens,
  formatJobRef,
  MAX_MANIFEST_TOKENS,
  matchCommand,
  parseCommandPattern,
  type JobStatus,
  type ParsedPattern,
  type RegexOracle,
  type SatelliteCommand,
} from "api-server-api";
import type { SatelliteRow } from "./types.js";

export const OFFLINE_AFTER_MS = 90_000;

export interface CompiledCommand {
  command: SatelliteCommand;
  parsed: ParsedPattern;
}

export type Compiled =
  | { ok: true; commands: CompiledCommand[] }
  | { ok: false; error: string };

export function compileCommands(commands: SatelliteCommand[]): Compiled {
  const compiled: CompiledCommand[] = [];
  for (const command of commands) {
    const parsed = parseCommandPattern(command.run);
    if (!parsed.ok)
      return { ok: false, error: `"${command.run}": ${parsed.error}` };
    compiled.push({ command, parsed: parsed.value });
  }
  const tokens = countTokens(compiled.map((c) => c.parsed));
  if (tokens > MAX_MANIFEST_TOKENS)
    return {
      ok: false,
      error: `these patterns hold ${tokens} tokens (max ${MAX_MANIFEST_TOKENS}) — a manifest this large costs the server more per command than it is worth`,
    };
  return { ok: true, commands: compiled };
}

export function isOnline(satellite: SatelliteRow, now: Date): boolean {
  if (satellite.lastSeenAt === null) return false;
  return now.getTime() - satellite.lastSeenAt.getTime() < OFFLINE_AFTER_MS;
}

export type Admission =
  | { ok: true; pattern: string; status: JobStatus; patternMax: number | null }
  | { ok: false; reason: string };

export interface ActiveCounts {
  total: number;
  byPattern: Map<string, number>;
}

export function admit(
  satellite: SatelliteRow,
  compiled: CompiledCommand[],
  cmd: string[],
  active: ActiveCounts,
  now: Date,
  oracle: RegexOracle,
): Admission {
  if (satellite.draining)
    return { ok: false, reason: `${satellite.name} is shutting down` };
  if (!isOnline(satellite, now))
    return {
      ok: false,
      reason:
        satellite.lastSeenAt === null
          ? `${satellite.name} has never connected`
          : `${satellite.name} is offline (last seen ${describeAge(now.getTime() - satellite.lastSeenAt.getTime())} ago)`,
    };

  const matched = matchCommand(
    compiled.map((c) => c.parsed),
    cmd,
    oracle,
  );
  if (!matched.ok)
    return {
      ok: false,
      reason: matched.closest
        ? `${matched.reason}. Closest permitted command: ${matched.closest}`
        : matched.reason,
    };

  const entry = compiled[matched.index]!;
  if (active.total >= satellite.maxConcurrent)
    return {
      ok: false,
      reason: `${satellite.name} is running ${active.total} jobs (max ${satellite.maxConcurrent}) — wait for one to finish`,
    };

  const perCommand = entry.command.maxConcurrent;
  if (perCommand !== undefined) {
    const running = active.byPattern.get(entry.command.run) ?? 0;
    if (running >= perCommand)
      return {
        ok: false,
        reason: `${entry.command.run} already has ${running} running (max ${perCommand}) — wait for one to finish`,
      };
  }

  return {
    ok: true,
    pattern: entry.command.run,
    status: entry.command.approval === "always" ? "pending-approval" : "queued",
    patternMax: perCommand ?? null,
  };
}

function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

export { formatJobRef };
