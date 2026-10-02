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
      if (v && typeof v === "object") {
        out.push(`${k}=`);
        for (const [nk, nv] of Object.entries(v)) {
          out.push(`  ${nk}=${String(nv)}`);
        }
      } else {
        out.push(`${k}=${String(v)}`);
      }
    }
  }
  return out.join("\n") + "\n";
}

const INI_SECTION = /^\[(.+)\]$/;

function parseIni(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let table = root;
  let nested: Record<string, unknown> | undefined;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const indented = /^\s/.test(raw);
    const section = indented ? null : INI_SECTION.exec(line);
    if (section) {
      table = {};
      root[section[1]!] = table;
      nested = undefined;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (indented && nested) {
      nested[key] = value;
    } else if (table !== root && value === "") {
      nested = {};
      table[key] = nested;
    } else {
      table[key] = value;
      nested = undefined;
    }
  }
  return root;
}
