import { dump as stringifyYaml } from "js-yaml";
import { loadYamlDocument } from "../../../core/yaml-document.js";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { FileFormat } from "agent-runtime-api";

export function parseFile(format: FileFormat, content: string): unknown {
  switch (format) {
    case "json":
      return content ? JSON.parse(content) : {};
    case "yaml":
      return loadYamlDocument(content) ?? {};
    case "toml":
      return content ? parseToml(content) : {};
    case "ini":
      return parseIni(content);
    case "text":
      return content;
  }
}

type IniSection = Record<string, string>;

function parseIni(content: string): Record<string, string | IniSection> {
  const out: Record<string, string | IniSection> = {};
  let section: IniSection | undefined;
  let lastKey: string | undefined;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    const target = section ?? out;
    if (/^\s/.test(line) && lastKey !== undefined) {
      target[lastKey] = `${String(target[lastKey])}\n${line}`;
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      section = {};
      out[trimmed.slice(1, -1).trim()] = section;
      lastKey = undefined;
      continue;
    }
    const eq = trimmed.indexOf("=");
    const key = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim();
    target[key] = eq === -1 ? "" : trimmed.slice(eq + 1).trim();
    lastKey = key;
  }
  return out;
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
    out.push(out.length === 0 ? `[${sec}]` : `\n[${sec}]`);
    for (const [k, v] of Object.entries(body)) {
      out.push(`${k}=${String(v)}`);
    }
  }
  return out.length === 0 ? "" : out.join("\n") + "\n";
}
