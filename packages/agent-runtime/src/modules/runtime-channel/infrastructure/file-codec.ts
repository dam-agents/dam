import { dump as stringifyYaml, load as parseYaml } from "js-yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { FileFormat } from "agent-runtime-api";

// Shared string<->object codec for every config-file format, used by both
// file-ops and the harness-config read path. Pure: no I/O.
export function parseFile(format: FileFormat, content: string): unknown {
  switch (format) {
    case "json":
      return content ? JSON.parse(content) : {};
    case "yaml":
      return parseYaml(content) ?? {};
    case "toml":
      return content ? parseToml(content) : {};
    case "ini":
    case "text":
      return content;
  }
}

export function serializeFile(format: FileFormat, value: unknown): string {
  switch (format) {
    case "json":
      return JSON.stringify(value, null, 2) + "\n";
    case "yaml":
      return stringifyYaml(value);
    case "toml":
      return stringifyToml(value as Record<string, unknown>) + "\n";
    case "text":
      return typeof value === "string" ? value : String(value ?? "");
    case "ini":
      return serializeIni(value);
  }
}

function serializeIni(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const out: string[] = [];
  const obj = value as Record<string, unknown>;
  const sections: [string, Record<string, unknown>][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      sections.push([k, v as Record<string, unknown>]);
    } else {
      out.push(`${k}=${String(v)}`);
    }
  }
  for (const [sec, body] of sections) {
    out.push(`\n[${sec}]`);
    for (const [k, v] of Object.entries(body)) {
      out.push(`${k}=${String(v)}`);
    }
  }
  return out.join("\n") + "\n";
}
