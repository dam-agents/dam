import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { load as parseYaml, dump as stringifyYaml } from "js-yaml";
import type { FileFormat, MergeMode } from "agent-runtime-api";

export interface FileDesired {
  format: FileFormat;
  mergeMode: MergeMode;
  content: unknown;
  keyPath?: string;
}

export interface FileOpsContext {
  agentHome: string;
  log: (msg: string) => void;
}

export interface FileOps {
  apply(
    desired: Map<string, FileDesired[] | null>,
    ctx: FileOpsContext,
  ): Promise<void>;
}

export function createFileOps(): FileOps {
  return {
    async apply(desired, ctx): Promise<void> {
      const home = stripTrailingSep(resolve(ctx.agentHome));
      for (const [path, fragments] of desired) {
        const target = resolve(path);
        if (home === "" || !target.startsWith(home + "/")) {
          ctx.log(
            `[file-ops] refused ${JSON.stringify(path)} — must be under ${ctx.agentHome}`,
          );
          continue;
        }

        if (fragments === null) {
          if (existsSync(target)) {
            try {
              unlinkSync(target);
              ctx.log(`[file-ops] removed ${target}`);
            } catch (err) {
              ctx.log(
                `[file-ops] failed to remove ${target}: ${(err as Error).message}`,
              );
            }
          } else {
            ctx.log(`[file-ops] remove ${target}: not present, noop`);
          }
          continue;
        }

        const existed = existsSync(target);
        let existing = existed ? readFileSync(target, "utf8") : "";
        if (existing && needsParse(fragments)) {
          const parseErr = probeParse(fragments[0]!.format, existing);
          if (parseErr) {
            const sidecar = `${target}.broken-${Date.now()}`;
            ctx.log(
              `[file-ops] ${target}: existing content is unparseable (${parseErr}); moving aside to ${sidecar} and rewriting from contributions`,
            );
            try {
              renameSync(target, sidecar);
            } catch (err) {
              ctx.log(
                `[file-ops] could not move ${target} → ${sidecar}: ${(err as Error).message}; overwriting in place`,
              );
            }
            existing = "";
          }
        }
        let merged: string;
        try {
          merged = mergeFragments(existing, fragments);
        } catch (err) {
          ctx.log(
            `[file-ops] merge failed for ${target}: ${(err as Error).message}`,
          );
          continue;
        }
        if (merged === existing) {
          ctx.log(
            `[file-ops] ${target}: fragments=${fragments.length} existing=${existing.length}B merged unchanged — skip`,
          );
          continue;
        }
        atomicWrite(target, merged);
        ctx.log(
          `[file-ops] ${target}: fragments=${fragments.length} existing=${existing.length}B → merged=${merged.length}B (${existed ? "updated" : "created"})`,
        );
      }
    },
  };
}

function mergeFragments(existing: string, fragments: FileDesired[]): string {
  if (fragments.length === 0) return existing;

  const firstFormat = fragments[0]!.format;
  const firstMergeMode = fragments[0]!.mergeMode;
  for (const f of fragments) {
    if (f.format !== firstFormat || f.mergeMode !== firstMergeMode) {
      throw new Error(
        `inconsistent format/mergeMode on same path: have ${firstFormat}/${firstMergeMode}, got ${f.format}/${f.mergeMode}`,
      );
    }
  }

  switch (firstMergeMode) {
    case "overwrite":
      return mergeOverwrite(firstFormat, fragments);
    case "key-targeted":
      return mergeKeyTargeted(existing, firstFormat, fragments);
    case "section-marker":
      return mergeSectionMarker(existing, firstFormat, fragments);
    case "yaml-fill-if-missing":
      return mergeYamlFillIfMissing(existing, fragments);
  }
}

function mergeOverwrite(format: FileFormat, fragments: FileDesired[]): string {
  const last = fragments[fragments.length - 1]!;
  return serialize(format, last.content);
}

function mergeKeyTargeted(
  existing: string,
  format: FileFormat,
  fragments: FileDesired[],
): string {
  const base = (existing ? parse(format, existing) : {}) as Record<
    string,
    unknown
  >;
  const next: Record<string, unknown> = { ...base };

  for (const f of fragments) {
    if (f.keyPath) {
      setNested(next, f.keyPath.split("."), f.content);
    } else if (f.content && typeof f.content === "object") {
      Object.assign(next, f.content as Record<string, unknown>);
    }
  }
  return serialize(format, next);
}

function mergeSectionMarker(
  existing: string,
  format: FileFormat,
  fragments: FileDesired[],
): string {
  const comment = commentSyntax(format);
  const startMarker = `${comment} >>> platform <<<`;
  const endMarker = `${comment} <<< platform >>>`;
  const lines = existing.split("\n");
  const out: string[] = [];
  let inMarked = false;
  for (const line of lines) {
    if (line.trim() === startMarker) {
      inMarked = true;
      continue;
    }
    if (line.trim() === endMarker) {
      inMarked = false;
      continue;
    }
    if (!inMarked) out.push(line);
  }
  while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop();

  const blocks = fragments.map((f) => serialize(format, f.content).trimEnd());
  const block = blocks.join("\n");
  return [...out, "", startMarker, block, endMarker, ""].join("\n");
}

function mergeYamlFillIfMissing(
  existing: string,
  fragments: FileDesired[],
): string {
  const base = (existing ? (parseYaml(existing) as unknown) : null) ?? {};
  const next = (
    typeof base === "object" && base !== null ? { ...(base as object) } : {}
  ) as Record<string, unknown>;
  let changed = false;
  for (const f of fragments) {
    if (!f.content || typeof f.content !== "object") continue;
    for (const [k, v] of Object.entries(f.content as Record<string, unknown>)) {
      if (!(k in next)) {
        next[k] = v;
        changed = true;
      }
    }
  }
  if (!changed) return existing;
  return stringifyYaml(next);
}

function parse(format: FileFormat, content: string): unknown {
  switch (format) {
    case "json":
      return content ? JSON.parse(content) : {};
    case "yaml":
      return parseYaml(content) ?? {};
    case "ini":
    case "text":
      return content;
  }
}

function needsParse(fragments: FileDesired[]): boolean {
  return fragments.some(
    (f) =>
      f.mergeMode === "key-targeted" || f.mergeMode === "yaml-fill-if-missing",
  );
}

function probeParse(format: FileFormat, content: string): string | null {
  try {
    parse(format, content);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

function serialize(format: FileFormat, value: unknown): string {
  switch (format) {
    case "json":
      return JSON.stringify(value, null, 2) + "\n";
    case "yaml":
      return stringifyYaml(value);
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

function commentSyntax(format: FileFormat): string {
  switch (format) {
    case "yaml":
    case "ini":
      return "#";
    case "json":
      return "//";
    case "text":
      return "#";
  }
}

function setNested(
  obj: Record<string, unknown>,
  segs: string[],
  value: unknown,
): void {
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i]!;
    if (!cur[s] || typeof cur[s] !== "object") cur[s] = {};
    cur = cur[s] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}

function stripTrailingSep(p: string): string {
  return p.endsWith("/") && p.length > 1 ? p.replace(/\/+$/, "") : p;
}

function atomicWrite(target: string, content: string): void {
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = target + ".tmp";
  writeFileSync(tmp, content, { mode: 0o666 });
  try {
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}
