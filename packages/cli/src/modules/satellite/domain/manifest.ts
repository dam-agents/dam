import { parse as parseToml } from "smol-toml";
import {
  DEFAULT_MAX_CONCURRENT,
  parseCommandPattern,
  satelliteManifestSchema,
  type ParsedPattern,
  type SatelliteManifest,
} from "api-server-api";

export interface LocalCommand {
  run: string;
  about?: string;
  approval?: "always";
  maxConcurrent?: number;
  cwd?: string;
  timeoutMs?: number;
  parsed: ParsedPattern;
}

export interface LocalManifest {
  pushed: SatelliteManifest;
  commands: LocalCommand[];
  cwd?: string;
  timeoutMs?: number;
}

export type ManifestResult =
  | { ok: true; value: LocalManifest }
  | { ok: false; error: string };

const DURATION = /^(\d+)(s|m|h)$/;

function parseDuration(text: unknown, where: string): number | string {
  if (text === undefined) return 0;
  if (typeof text !== "string")
    return `${where}: timeout must be a string like "30m"`;
  const found = DURATION.exec(text);
  if (!found) return `${where}: timeout must look like 90s, 30m or 6h`;
  const n = Number(found[1]);
  return found[2] === "s"
    ? n * 1000
    : found[2] === "m"
      ? n * 60_000
      : n * 3_600_000;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseManifest(text: string): ManifestResult {
  let raw: unknown;
  try {
    raw = parseToml(text);
  } catch (err) {
    return { ok: false, error: `not valid TOML: ${(err as Error).message}` };
  }
  const root = asRecord(raw);
  if (root === null)
    return { ok: false, error: "manifest must be a TOML table" };

  const name = root.name;
  if (typeof name !== "string" || name === "")
    return { ok: false, error: "manifest needs a name" };

  const satelliteTimeout = parseDuration(root.timeout, "satellite");
  if (typeof satelliteTimeout === "string")
    return { ok: false, error: satelliteTimeout };

  const rawCommands = Array.isArray(root.command) ? root.command : [];
  if (rawCommands.length === 0)
    return { ok: false, error: "manifest declares no [[command]]" };

  const commands: LocalCommand[] = [];
  for (const entry of rawCommands) {
    const command = asRecord(entry);
    if (command === null)
      return { ok: false, error: "[[command]] must be a table" };
    const run = command.run;
    if (typeof run !== "string")
      return { ok: false, error: "[[command]] needs a run pattern" };

    const parsed = parseCommandPattern(run);
    if (!parsed.ok) return { ok: false, error: `"${run}": ${parsed.error}` };

    const timeout = parseDuration(command.timeout, `"${run}"`);
    if (typeof timeout === "string") return { ok: false, error: timeout };

    if (command.approval !== undefined && command.approval !== "always")
      return {
        ok: false,
        error: `"${run}": approval may only be "always"`,
      };

    commands.push({
      run,
      about: typeof command.about === "string" ? command.about : undefined,
      approval: command.approval === "always" ? "always" : undefined,
      maxConcurrent:
        typeof command.max_concurrent === "number"
          ? command.max_concurrent
          : undefined,
      cwd: typeof command.cwd === "string" ? command.cwd : undefined,
      timeoutMs: timeout > 0 ? timeout : undefined,
      parsed: parsed.value,
    });
  }

  const pushed = {
    name,
    description:
      typeof root.description === "string" ? root.description : undefined,
    maxConcurrent:
      typeof root.max_concurrent === "number"
        ? root.max_concurrent
        : DEFAULT_MAX_CONCURRENT,
    commands: commands.map((c) => ({
      run: c.run,
      ...(c.about !== undefined ? { about: c.about } : {}),
      ...(c.approval !== undefined ? { approval: c.approval } : {}),
      ...(c.maxConcurrent !== undefined
        ? { maxConcurrent: c.maxConcurrent }
        : {}),
    })),
  };

  const validated = satelliteManifestSchema.safeParse(pushed);
  if (!validated.success) {
    const first = validated.error.issues[0];
    return {
      ok: false,
      error:
        first === undefined
          ? "manifest is not valid"
          : `${first.path.join(".") || "manifest"}: ${first.message}`,
    };
  }

  return {
    ok: true,
    value: {
      pushed: validated.data,
      commands,
      cwd: typeof root.cwd === "string" ? root.cwd : undefined,
      timeoutMs: satelliteTimeout > 0 ? satelliteTimeout : undefined,
    },
  };
}
