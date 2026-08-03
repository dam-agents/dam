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
import { parseFile, serializeFile } from "./file-codec.js";

export interface FileDesired {
  format: FileFormat;
  mergeMode: MergeMode;
  content: unknown;
  keyPath?: string;
  // key-targeted only: delete `keyPath` (pruning emptied ancestors) instead of set.
  delete?: boolean;
}

export interface FileOpsContext {
  agentHome: string;
  log: (msg: string) => void;
  // Unparseable existing file on a merge that reads it: "rewrite-aside" (default)
  // moves it to a `.broken-*` sidecar and rewrites; "throw" aborts untouched (for
  // a one-shot apply over a possibly hand-edited file).
  onUnparseable?: "rewrite-aside" | "throw";
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
          if (parseErr && ctx.onUnparseable === "throw") {
            throw new Error(
              `[file-ops] ${target} is unparseable as ${fragments[0]!.format} (${parseErr}); refusing to overwrite`,
            );
          }
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
  return serializeFile(format, last.content);
}

function mergeKeyTargeted(
  existing: string,
  format: FileFormat,
  fragments: FileDesired[],
): string {
  const base = (existing ? parseFile(format, existing) : {}) as Record<
    string,
    unknown
  >;
  const next: Record<string, unknown> = { ...base };

  for (const f of fragments) {
    if (f.delete) {
      if (f.keyPath) deleteNested(next, f.keyPath.split("."));
    } else if (f.keyPath) {
      setNested(next, f.keyPath.split("."), f.content);
    } else if (f.content && typeof f.content === "object") {
      Object.assign(next, f.content as Record<string, unknown>);
    }
  }
  return serializeFile(format, next);
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

  const blocks = fragments.map((f) =>
    serializeFile(format, f.content).trimEnd(),
  );
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

function needsParse(fragments: FileDesired[]): boolean {
  return fragments.some(
    (f) =>
      f.mergeMode === "key-targeted" || f.mergeMode === "yaml-fill-if-missing",
  );
}

function probeParse(format: FileFormat, content: string): string | null {
  try {
    parseFile(format, content);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

function commentSyntax(format: FileFormat): string {
  switch (format) {
    case "yaml":
    case "ini":
    case "toml":
      return "#";
    case "json":
      return "//";
    case "text":
      return "#";
  }
}

export function setNested(
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

// Deletes the leaf at `segs`, leaving sibling keys intact, and prunes any
// ancestor object our deletion leaves empty (so removing
// `permissions.defaultMode` from `{ permissions: { defaultMode } }` drops the
// whole `permissions` key, but keeps it if the user has other keys under it).
// No-op if any segment along the way is missing.
export function deleteNested(
  obj: Record<string, unknown>,
  segs: string[],
): void {
  if (segs.length === 0) return;
  const [head, ...rest] = segs as [string, ...string[]];
  if (rest.length === 0) {
    delete obj[head];
    return;
  }
  const child = obj[head];
  if (!child || typeof child !== "object") return;
  const childObj = child as Record<string, unknown>;
  deleteNested(childObj, rest);
  if (Object.keys(childObj).length === 0) delete obj[head];
}

// Reads the leaf at `segs`, or undefined if any segment is missing or a
// non-object is hit along the way. Inverse of setNested — the harness-config
// read path uses it to map config-file key paths back to logical fields.
export function getNested(
  obj: Record<string, unknown>,
  segs: string[],
): unknown {
  let cur: unknown = obj;
  for (const s of segs) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
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
