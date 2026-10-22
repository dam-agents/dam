import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { dump as stringifyYaml } from "js-yaml";
import { loadYamlDocument } from "../../../core/yaml-document.js";
import type { FileFormat, MergeMode } from "agent-runtime-api";
import { parseFile, serializeFile } from "./file-codec.js";

export interface FileDesired {
  format: FileFormat;
  mergeMode: MergeMode;
  content: unknown;
  keyPath?: string;
  /** UNIT_BOUNDARY_DESCRIPTION: a path whose segments are taken literally,
   * for a key a dotted `keyPath` cannot carry. */
  keyPathArray?: string[];
  keys?: string[];
  delete?: boolean;
}

export interface FileOpsContext {
  agentHome: string;
  log: (msg: string) => void;
  onUnparseable?: "rewrite-aside" | "throw";
}

/** UNIT_BOUNDARY_DESCRIPTION: one apply at a time, so two drivers that merge
 * into the same file cannot each read it before the other writes and lose a
 * key. */
let queue: Promise<void> = Promise.resolve();

const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 30_000;

export function applyFiles(
  desired: Map<string, FileDesired[] | null>,
  ctx: FileOpsContext,
): Promise<void> {
  const run = queue.then(() => applyFilesNow(desired, ctx));
  queue = run.catch(() => {});
  return run;
}

async function applyFilesNow(
  desired: Map<string, FileDesired[] | null>,
  ctx: FileOpsContext,
): Promise<void> {
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

    if (!existsSync(target) && fragments.every((f) => f.delete)) {
      ctx.log(`[file-ops] ${target}: nothing to remove, not present`);
      continue;
    }
    try {
      await withLock(target, () => {
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
          return;
        }
        if (merged === existing) {
          ctx.log(
            `[file-ops] ${target}: fragments=${fragments.length} existing=${existing.length}B merged unchanged — skip`,
          );
          return;
        }
        atomicWrite(target, merged);
        ctx.log(
          `[file-ops] ${target}: fragments=${fragments.length} existing=${existing.length}B → merged=${merged.length}B (${existed ? "updated" : "created"})`,
        );
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ELOCKED") throw err;
      if (ctx.onUnparseable === "throw") throw err;
      ctx.log(`[file-ops] ${(err as Error).message}`);
    }
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: every writer of a file that has more than one holds
 * `<file>.lock` across its read-modify-write, so no writer's change is written
 * over by a copy another writer read before it. A writer that takes no lock —
 * Claude Code itself, a hand edit, a kit that predates the rule — can still be
 * overwritten between our read and our rename. A lock whose writer is gone is
 * broken, so a writer that died inside its section never blocks the file for
 * good; of two waiters that break the same stale lock, the one whose rename
 * took a newer lock puts it back.
 */
async function withLock(target: string, write: () => void): Promise<void> {
  const lockPath = `${target}.lock`;
  mkdirSync(dirname(target), { recursive: true });
  const mine = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      writeFileSync(lockPath, mine, { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    let holder: string;
    let age: number;
    try {
      holder = readFileSync(lockPath, "utf8").split(":")[0]!;
      age = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      continue;
    }
    if (age > LOCK_STALE_MS && /^\d+$/.test(holder) && !alive(Number(holder))) {
      const aside = `${lockPath}.stale.${mine}`;
      try {
        renameSync(lockPath, aside);
        if (readFileSync(aside, "utf8").split(":")[0] !== holder) {
          try {
            linkSync(aside, lockPath);
          } catch {}
        }
      } catch {}
      try {
        unlinkSync(aside);
      } catch {}
      continue;
    }
    if (Date.now() >= deadline) {
      throw Object.assign(
        new Error(
          `[file-ops] ${lockPath} stayed locked for ${LOCK_WAIT_MS} ms; leaving ${target} as it is`,
        ),
        { code: "ELOCKED" },
      );
    }
    await new Promise((done) => setTimeout(done, 5));
  }
  try {
    write();
  } finally {
    try {
      if (readFileSync(lockPath, "utf8") === mine) unlinkSync(lockPath);
    } catch {}
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
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
    const path = f.keyPathArray ?? (f.keyPath ? f.keyPath.split(".") : null);
    if (f.delete) {
      if (path) deleteNested(next, path);
      for (const key of f.keys ?? []) delete next[key];
    } else if (path) {
      setNested(next, path, f.content);
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

  const blocks = fragments
    .filter((f) => !f.delete)
    .map((f) => serializeFile(format, f.content).trimEnd());
  if (blocks.length === 0) {
    return out.length === 0 ? "" : out.join("\n") + "\n";
  }
  const block = blocks.join("\n");
  return [...out, "", startMarker, block, endMarker, ""].join("\n");
}

function mergeYamlFillIfMissing(
  existing: string,
  fragments: FileDesired[],
): string {
  const base =
    (existing ? (loadYamlDocument(existing) as unknown) : null) ?? {};
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
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, { mode: 0o666 });
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}
