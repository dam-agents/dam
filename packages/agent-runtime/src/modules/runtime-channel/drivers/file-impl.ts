import {
  chmodSync,
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

/**
 * Built-in `file` impl. Materializes a per-path desired state on disk by
 * combining (format × mergeMode) drivers — see ADR-052's removal-semantics
 * table.
 *
 * Atomic on-disk writes via `tmp + rename`. Refuses paths that don't resolve
 * under `agentHome` — defense-in-depth against a buggy api-server payload.
 *
 * The impl receives `desiredByPath` — every contribution targeting one path
 * is merged into one desired-state value before write. Removal of paths is
 * handled by the dispatcher (passes a path with `desired = null`).
 */

export interface FileDesired {
  format: FileFormat;
  mergeMode: MergeMode;
  // `content` is the per-contribution payload — interpretation depends on
  // mergeMode.
  content: unknown;
  // Optional key-path prefix the content should be merged into. Used by the
  // `mcp-entry` binding to drop entries under `mcpServers.<name>`.
  keyPath?: string;
}

export interface FileImplContext {
  agentHome: string;
  log: (msg: string) => void;
}

export interface FileImplOps {
  /**
   * @param desired Map of absolute-resolved path → null (remove) or list of
   *                desired fragments (merged inside the impl per mergeMode).
   */
  apply(
    desired: Map<string, FileDesired[] | null>,
    ctx: FileImplContext,
  ): Promise<void>;
}

export function createFileImpl(): FileImplOps {
  return {
    async apply(
      desired: Map<string, FileDesired[] | null>,
      ctx: FileImplContext,
    ): Promise<void> {
      const home = stripTrailingSep(resolve(ctx.agentHome));
      for (const [path, fragments] of desired) {
        const target = resolve(path);
        if (home === "" || !target.startsWith(home + "/")) {
          ctx.log(
            `[file] refused ${JSON.stringify(path)} — must be under ${ctx.agentHome}`,
          );
          continue;
        }

        if (fragments === null) {
          // Removal — `overwrite`/`section-marker`/`key-targeted` map removal
          // to "drop this path" (overwrite) or "remove our keys/sections"
          // (handled at merge time, see below). For overwrite, we delete the
          // file if it exists.
          if (existsSync(target)) {
            try {
              unlinkSync(target);
            } catch (err) {
              ctx.log(
                `[file] failed to remove ${target}: ${(err as Error).message}`,
              );
            }
          }
          continue;
        }

        const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
        let merged: string;
        try {
          merged = mergeFragments(existing, fragments);
        } catch (err) {
          ctx.log(
            `[file] merge failed for ${target}: ${(err as Error).message}`,
          );
          continue;
        }
        if (merged === existing) continue;
        atomicWrite(target, merged);
      }
    },
  };
}

function mergeFragments(existing: string, fragments: FileDesired[]): string {
  if (fragments.length === 0) return existing;

  // All fragments on one path must agree on format + mergeMode. The
  // contribution-fanout layer is responsible for picking one; if we ever
  // see inconsistent modes here, it's an api-server bug.
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
  // Overwrite combines all fragments — for object formats, deep-merge; for
  // text, last writer wins. There's usually only one fragment per path on
  // overwrite, but we don't assume.
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
  const owned = collectKeyTargetedKeys(fragments);
  const next: Record<string, unknown> = { ...base };

  // Drop platform-owned keys from the base. We can't tell platform-owned
  // from user-owned at the file level — the dispatcher tracks ownership in
  // `$HOME/.platform/<kind>.json` and re-derives the owned-keys set on every
  // apply. Here we trust the dispatcher's accounting via the fragments.
  for (const k of owned.toDrop) {
    if (k.includes(".")) {
      removeNestedKey(next, k.split("."));
    } else {
      delete next[k];
    }
  }

  // Merge desired content into the appropriate keyPath sub-tree.
  for (const f of fragments) {
    if (f.keyPath) {
      const segs = f.keyPath.split(".");
      setNested(next, segs, deepMerge(getNested(next, segs), f.content));
    } else if (f.content && typeof f.content === "object") {
      Object.assign(next, f.content as Record<string, unknown>);
    }
  }
  return serialize(format, next);
}

interface KeyTargetedAccounting {
  toDrop: string[];
}

function collectKeyTargetedKeys(
  fragments: FileDesired[],
): KeyTargetedAccounting {
  // Each fragment's `content` is expected to be an object whose top-level
  // keys are the platform-owned set being merged. For nested keyPath, drop
  // any prior child key under that prefix.
  const keys = new Set<string>();
  for (const f of fragments) {
    if (f.keyPath && f.content && typeof f.content === "object") {
      for (const k of Object.keys(f.content as Record<string, unknown>)) {
        keys.add(`${f.keyPath}.${k}`);
      }
    } else if (f.content && typeof f.content === "object") {
      for (const k of Object.keys(f.content as Record<string, unknown>)) {
        keys.add(k);
      }
    }
  }
  return { toDrop: Array.from(keys) };
}

function mergeSectionMarker(
  existing: string,
  format: FileFormat,
  fragments: FileDesired[],
): string {
  // Strip the platform-marked block, then re-insert with current fragments.
  // Markers: lines `# >>> platform <<<` … `# <<< platform >>>` (comment
  // syntax depends on format).
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
  // Drop trailing empty lines so we don't accumulate blank lines on each
  // re-apply.
  while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop();

  // Serialize each fragment's content and concatenate inside the markers.
  const blocks = fragments.map((f) => serialize(format, f.content).trimEnd());
  const block = blocks.join("\n");
  return [...out, "", startMarker, block, endMarker, ""].join("\n");
}

function mergeYamlFillIfMissing(
  existing: string,
  fragments: FileDesired[],
): string {
  // Legacy carve-out (ADR-052): additive only. Adds top-level keys that
  // don't yet exist; never removes. Drivers using this leave stale entries
  // on connection detach.
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

function serialize(format: FileFormat, value: unknown): string {
  switch (format) {
    case "json":
      return JSON.stringify(value, null, 2) + "\n";
    case "yaml":
      return stringifyYaml(value);
    case "text":
      return typeof value === "string" ? value : String(value ?? "");
    case "ini":
      // Minimal INI emitter: top-level keys flat, section objects nested.
      // Sufficient for the small set of INI files platform writes.
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
      // JSON has no comments; section-marker is incompatible. The dispatcher
      // should reject this combination at composition time, but we fall back
      // to `//` here so the failure is local.
      return "//";
    case "text":
      return "#";
  }
}

function deepMerge(a: unknown, b: unknown): unknown {
  if (a && b && typeof a === "object" && typeof b === "object") {
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return b ?? a;
}

function getNested(obj: Record<string, unknown>, segs: string[]): unknown {
  let cur: unknown = obj;
  for (const s of segs) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
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

function removeNestedKey(obj: Record<string, unknown>, segs: string[]): void {
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i]!;
    if (!cur[s] || typeof cur[s] !== "object") return;
    cur = cur[s] as Record<string, unknown>;
  }
  delete cur[segs[segs.length - 1]!];
}

function stripTrailingSep(p: string): string {
  return p.endsWith("/") && p.length > 1 ? p.replace(/\/+$/, "") : p;
}

function atomicWrite(target: string, content: string): void {
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  // 0o777 dir / 0o666 file: the agent runs non-root but may edit these
  // files in place (gh CLI writes hosts.yml.lock etc.). Same convention as
  // the retiring pod-files apply.
  chmodSync(dir, 0o777);
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
