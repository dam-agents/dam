import { createHash } from "node:crypto";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const OPAQUE_ID_RE = /\b(toolu|req)_[A-Za-z0-9]{6,}\b/g;

export interface SynthesizeOptions {
  template: string;
  sessionId: string;
  cwd: string;
  repetitions: number;
}

interface TemplateInfo {
  sessionId: string;
  cwd: string;
  firstTimestampMs: number;
  durationMs: number;
  rootLineIndex: number;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = Record<string, JsonValue>;

function hashHex(parts: string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex");
}

function deterministicUuid(seed: string): string {
  const h = hashHex(["uuid", seed]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function deterministicOpaqueId(
  prefix: string,
  seed: string,
  length: number,
): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  let round = 0;
  while (out.length < length) {
    const h = hashHex(["opaque", prefix, seed, String(round)]);
    for (let i = 0; i + 1 < h.length && out.length < length; i += 2) {
      out += alphabet[parseInt(h.slice(i, i + 2), 16) % alphabet.length];
    }
    round += 1;
  }
  return `${prefix}_${out}`;
}

function analyzeTemplate(lines: JsonObject[]): TemplateInfo {
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let rootLineIndex = -1;
  const timestamps: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (sessionId === undefined && typeof line.sessionId === "string") {
      sessionId = line.sessionId;
    }
    if (cwd === undefined && typeof line.cwd === "string") {
      cwd = line.cwd;
    }
    if (
      rootLineIndex < 0 &&
      line.parentUuid === null &&
      typeof line.uuid === "string"
    ) {
      rootLineIndex = index;
    }
    if (typeof line.timestamp === "string") {
      const ms = Date.parse(line.timestamp);
      if (!Number.isNaN(ms)) timestamps.push(ms);
    }
  }
  if (sessionId === undefined || cwd === undefined || rootLineIndex < 0) {
    throw new Error(
      "template is missing a sessionId, cwd, or root line and cannot be synthesized from",
    );
  }
  const firstTimestampMs = Math.min(...timestamps);
  const durationMs = Math.max(...timestamps) - firstTimestampMs;
  return { sessionId, cwd, firstTimestampMs, durationMs, rootLineIndex };
}

function remapStrings(
  value: JsonValue,
  remap: (text: string) => string,
): JsonValue {
  if (typeof value === "string") return remap(value);
  if (Array.isArray(value)) return value.map((v) => remapStrings(v, remap));
  if (value !== null && typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = remapStrings(inner, remap);
    }
    return out;
  }
  return value;
}

export function synthesizeSessionFile(opts: SynthesizeOptions): string {
  const rawLines = opts.template
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const templateLines = rawLines.map((line) => JSON.parse(line) as JsonObject);
  const info = analyzeTemplate(templateLines);
  const repetitionGapMs = 60_000;

  const output: string[] = [];
  let previousRepetitionLeafUuid: string | null = null;

  for (let rep = 0; rep < opts.repetitions; rep += 1) {
    const idMap = new Map<string, string>();
    const mapUuid = (id: string): string => {
      const lower = id.toLowerCase();
      if (lower === info.sessionId.toLowerCase()) return opts.sessionId;
      let mapped = idMap.get(lower);
      if (mapped === undefined) {
        mapped = deterministicUuid(
          [opts.sessionId, String(rep), lower].join(":"),
        );
        idMap.set(lower, mapped);
      }
      return mapped;
    };
    const mapOpaque = (id: string): string => {
      let mapped = idMap.get(id);
      if (mapped === undefined) {
        const [prefix] = id.split("_", 1);
        mapped = deterministicOpaqueId(
          prefix ?? "toolu",
          [opts.sessionId, String(rep), id].join(":"),
          id.length - (prefix ?? "toolu").length - 1,
        );
        idMap.set(id, mapped);
      }
      return mapped;
    };
    const remap = (text: string): string =>
      text
        .split(info.cwd)
        .join(opts.cwd)
        .replace(UUID_RE, (id) => mapUuid(id))
        .replace(OPAQUE_ID_RE, (id) => mapOpaque(id));

    const timeOffsetMs = rep * (info.durationMs + repetitionGapMs);
    let repetitionLeafUuid: string | null = null;

    for (const [index, templateLine] of templateLines.entries()) {
      const line = remapStrings(templateLine, remap) as JsonObject;
      if (typeof line.timestamp === "string") {
        const ms = Date.parse(line.timestamp);
        if (!Number.isNaN(ms)) {
          line.timestamp = new Date(ms + timeOffsetMs).toISOString();
        }
      }
      if (
        rep > 0 &&
        index === info.rootLineIndex &&
        previousRepetitionLeafUuid !== null
      ) {
        line.parentUuid = previousRepetitionLeafUuid;
      }
      if (
        (line.type === "user" || line.type === "assistant") &&
        typeof line.uuid === "string"
      ) {
        repetitionLeafUuid = line.uuid;
      }
      output.push(JSON.stringify(line));
    }
    previousRepetitionLeafUuid = repetitionLeafUuid;
  }
  return `${output.join("\n")}\n`;
}
