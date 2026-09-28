import { satelliteNameSchema } from "api-server-api";
import { parseCommandPattern, type ParsedPattern } from "./command-pattern.js";

export interface LocalCommand {
  run: string;
  about?: string;
  maxConcurrent?: number;
  cwd?: string;
  timeoutMs?: number;
  parsed: ParsedPattern;
}

export interface SurfaceIdentity {
  name: string;
  description?: string;
  maxConcurrent: number;
}

export interface CommandSurface {
  pushed: SurfaceIdentity;
  commands: LocalCommand[];
  cwd?: string;
  timeoutMs?: number;
}

export type SurfaceResult =
  { ok: true; value: CommandSurface } | { ok: false; error: string };

export interface SurfaceDefaults {
  name: string;
  description?: string;
  maxConcurrent: number;
  cwd?: string;
  timeout?: string;
}

const DURATION = /^(\d+)(s|m|h)$/;
const MAX_TIMEOUT_MS = 2_147_483_647;

export function parseDuration(text: string, where: string): number | string {
  const found = DURATION.exec(text);
  if (!found) return `${where}: timeout must look like 90s, 30m or 6h`;
  const n = Number(found[1]);
  const ms =
    found[2] === "s" ? n * 1000 : found[2] === "m" ? n * 60_000 : n * 3_600_000;
  return ms > MAX_TIMEOUT_MS
    ? `${where}: timeout must be under 24 days — a longer one overflows the timer and would kill the job at once`
    : ms;
}

function splitComment(line: string): { pattern: string; comment: string } {
  for (let i = 0; i < line.length; i++)
    if (line[i] === "#" && (i === 0 || /\s/.test(line[i - 1]!)))
      return {
        pattern: line.slice(0, i).trim(),
        comment: line.slice(i + 1).trim(),
      };
  return { pattern: line.trim(), comment: "" };
}

interface LineOptions {
  maxConcurrent?: number;
  cwd?: string;
  timeoutMs?: number;
}

function parseOptions(group: string, where: string): LineOptions | string {
  const options: LineOptions = {};
  for (const token of group.split(/\s+/).filter((t) => t !== "")) {
    const [key, ...rest] = token.split("=");
    const value = rest.join("=");
    if (key === "max") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 1024)
        return `${where}: max must be a whole number between 1 and 1024`;
      options.maxConcurrent = n;
    } else if (key === "timeout") {
      const ms = parseDuration(value, where);
      if (typeof ms === "string") return ms;
      options.timeoutMs = ms;
    } else if (key === "cwd") {
      if (value === "") return `${where}: cwd needs a path`;
      options.cwd = value;
    } else {
      return `${where}: unknown option "${token}" — use max=N, timeout=D or cwd=PATH`;
    }
  }
  return options;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads the command surface a user writes on the
 * command line or pipes in — one usage line per permitted command, a `#`
 * description, and a trailing `[…]` group for the few per-command settings. The
 * text is the whole manifest: there is no file, so nothing can drift between
 * what the user wrote and what the machine enforces, and changing it means
 * restarting the worker rather than signalling it.
 *
 * A `#` opens the description only where a shell would see one — at the start of
 * a line or after whitespace — so an anchored regex may hold a bare `#` without
 * escaping and cannot be silently truncated. An option the bracket group does
 * not know is refused rather than ignored: a dropped `approval` is the one
 * mistake this format must not make.
 */
export function parseCommandSurface(
  text: string,
  defaults: SurfaceDefaults,
): SurfaceResult {
  const parsedName = satelliteNameSchema.safeParse(defaults.name);
  if (!parsedName.success)
    return {
      ok: false,
      error: `--name: ${parsedName.error.issues[0]?.message ?? "invalid"}`,
    };

  if (
    !Number.isInteger(defaults.maxConcurrent) ||
    defaults.maxConcurrent < 1 ||
    defaults.maxConcurrent > 1024
  )
    return {
      ok: false,
      error: "--max-concurrent must be a whole number between 1 and 1024",
    };

  let timeoutMs: number | undefined;
  if (defaults.timeout !== undefined) {
    const ms = parseDuration(defaults.timeout, "--timeout");
    if (typeof ms === "string") return { ok: false, error: ms };
    timeoutMs = ms;
  }

  const commands: LocalCommand[] = [];
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const { pattern, comment } = splitComment(raw);
    if (pattern === "") continue;
    const where = `line ${index + 1}`;

    const parsed = parseCommandPattern(pattern);
    if (!parsed.ok)
      return { ok: false, error: `${where}: "${pattern}": ${parsed.error}` };

    const group = /\[([^\]]*)\]\s*$/.exec(comment);
    const options = parseOptions(group?.[1] ?? "", where);
    if (typeof options === "string") return { ok: false, error: options };
    const about =
      group === null ? comment : comment.slice(0, group.index).trim();

    commands.push({
      run: pattern,
      ...(about === "" ? {} : { about }),
      ...options,
      parsed: parsed.value,
    });
  }

  if (commands.length === 0)
    return { ok: false, error: "no command patterns — nothing to expose" };

  return {
    ok: true,
    value: {
      pushed: {
        name: parsedName.data,
        ...(defaults.description === undefined
          ? {}
          : { description: defaults.description }),
        maxConcurrent: defaults.maxConcurrent,
      },
      commands,
      ...(defaults.cwd === undefined ? {} : { cwd: defaults.cwd }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  };
}
