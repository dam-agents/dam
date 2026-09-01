import { dirname, resolve } from "node:path";
import {
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat as statAsync,
  writeFile,
} from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import type {
  DirEntry,
  DirListResult,
  FileReadResult,
  FilesDomainError,
  FilesService,
  FileWriteOk,
  Result,
} from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";

import { IMPORT_STAGING_PREFIX } from "../core/import-staging.js";
import { noticeStream } from "../core/notice-stream.js";
import { createFilesWatcher } from "./files-watch.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const RESERVED = new Set([".triggers", ".initialized"]);

function hasNullBytes(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

export function safePath(workingDir: string, rel: string): string | null {
  const resolved = resolve(workingDir, rel);
  if (!resolved.startsWith(resolve(workingDir))) return null;
  return resolved;
}

export function touchesReserved(rel: string): boolean {
  if (!rel) return false;
  return rel.split("/").some((seg) => RESERVED.has(seg));
}

function isWritablePath(rel: string): boolean {
  if (!rel) return false;
  const parts = rel.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") return false;
    if (RESERVED.has(part)) return false;
  }
  return true;
}

const forbidden = (reason: string): FilesDomainError => ({
  kind: "Forbidden",
  reason,
});

function compareEntries(a: DirEntry, b: DirEntry): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

async function listDir(
  workingDir: string,
  rel: string,
): Promise<DirListResult> {
  if (touchesReserved(rel)) {
    return { path: rel, ok: false, error: "forbidden" };
  }
  const abs = safePath(workingDir, rel);
  if (!abs) return { path: rel, ok: false, error: "forbidden" };
  try {
    const ents = await readdir(abs, { withFileTypes: true });
    const entries: DirEntry[] = ents
      .filter(
        (ent) =>
          !RESERVED.has(ent.name) &&
          !ent.name.startsWith(IMPORT_STAGING_PREFIX),
      )
      .map(
        (ent): DirEntry => ({
          name: ent.name,
          type: ent.isDirectory() ? "dir" : "file",
        }),
      )
      .sort(compareEntries);
    return { path: rel, ok: true, entries };
  } catch {
    return { path: rel, ok: false, error: "not-found" };
  }
}

export function createFilesService(workingDir: string): FilesService {
  const watcher = createFilesWatcher(workingDir);
  const toAbs = (rel: string): string | null => safePath(workingDir, rel);
  const toWritableAbs = (rel: string): string | null => {
    if (!isWritablePath(rel)) return null;
    return toAbs(rel);
  };

  return {
    listDirs: (paths) => Promise.all(paths.map((p) => listDir(workingDir, p))),
    watchDirs: (paths, signal) =>
      noticeStream(
        { topic: "workspace" } as const,
        (onChange) => watcher.watchDirs(paths, onChange),
        signal,
      ),
    watchFile: (path, signal) =>
      noticeStream(
        { topic: "file", path } as const,
        (onChange) => watcher.watchFile(path, onChange),
        signal,
      ),
    readFileSafe: async (
      rel,
    ): Promise<Result<FileReadResult, FilesDomainError>> => {
      if (!rel) return err({ kind: "NotFound", path: rel });
      if (touchesReserved(rel)) return err(forbidden("reserved path"));
      const abs = toAbs(rel);
      if (!abs) return err({ kind: "NotFound", path: rel });
      let fh;
      try {
        fh = await open(abs, "r");
        const s = await fh.stat();
        if (!s.isFile()) return err({ kind: "NotFound", path: rel });
        if (s.size > MAX_FILE_SIZE) {
          return err({
            kind: "PayloadTooLarge",
            detail: `file ${s.size} bytes (max ${MAX_FILE_SIZE})`,
          });
        }
        const buf = await fh.readFile();
        const mtimeMs = s.mtimeMs;
        const type = await fileTypeFromBuffer(buf);
        if (type) {
          return ok({
            path: rel,
            content: buf.toString("base64"),
            binary: true,
            mimeType: type.mime,
            mtimeMs,
          });
        }
        if (hasNullBytes(buf)) {
          return ok({
            path: rel,
            content: buf.toString("base64"),
            binary: true,
            mimeType: "application/octet-stream",
            mtimeMs,
          });
        }
        const content = buf.toString("utf8");
        const lower = rel.toLowerCase();
        const mimeType = lower.endsWith(".svg")
          ? "image/svg+xml"
          : lower.endsWith(".json") || lower.endsWith(".jsonl")
            ? "application/json"
            : lower.endsWith(".csv")
              ? "text/csv"
              : lower.endsWith(".html") || lower.endsWith(".htm")
                ? "text/html"
                : lower.endsWith(".md") || lower.endsWith(".mdx")
                  ? "text/markdown"
                  : lower.endsWith(".xml")
                    ? "application/xml"
                    : "text/plain";
        return ok({ path: rel, content, binary: false, mimeType, mtimeMs });
      } catch {
        return err({ kind: "NotFound", path: rel });
      } finally {
        await fh?.close();
      }
    },
    writeFileSafe: async (
      rel,
      content,
      expectedMtimeMs,
    ): Promise<Result<FileWriteOk, FilesDomainError>> => {
      const abs = toWritableAbs(rel);
      if (!abs) return err(forbidden("forbidden path"));
      if (expectedMtimeMs !== undefined) {
        try {
          const s = await statAsync(abs);
          if (Math.abs(s.mtimeMs - expectedMtimeMs) > 0.5) {
            return err({ kind: "Conflict", currentMtimeMs: s.mtimeMs });
          }
        } catch {
          return err({ kind: "Conflict", currentMtimeMs: 0 });
        }
      }
      await writeFile(abs, content, "utf8");
      const s = await statAsync(abs);
      return ok({ mtimeMs: s.mtimeMs });
    },
    createFileSafe: async (
      rel,
      content,
    ): Promise<Result<FileWriteOk, FilesDomainError>> => {
      const abs = toWritableAbs(rel);
      if (!abs) return err(forbidden("forbidden path"));
      await mkdir(dirname(abs), { recursive: true });
      try {
        await writeFile(abs, content, { flag: "wx", encoding: "utf8" });
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException)?.code === "EEXIST") {
          return err({ kind: "AlreadyExists", path: rel });
        }
        throw e;
      }
      const s = await statAsync(abs);
      return ok({ mtimeMs: s.mtimeMs });
    },
    mkdirSafe: async (rel): Promise<Result<{ ok: true }, FilesDomainError>> => {
      const abs = toWritableAbs(rel);
      if (!abs) return err(forbidden("forbidden path"));
      try {
        const s = await statAsync(abs);
        if (!s.isDirectory()) return err({ kind: "AlreadyExists", path: rel });
        return ok({ ok: true });
      } catch {}
      await mkdir(abs, { recursive: true });
      return ok({ ok: true });
    },
    renameSafe: async (
      from,
      to,
      overwrite,
    ): Promise<Result<{ ok: true }, FilesDomainError>> => {
      const fromAbs = toWritableAbs(from);
      const toAbs2 = toWritableAbs(to);
      if (!fromAbs || !toAbs2) return err(forbidden("forbidden path"));
      if (!overwrite) {
        try {
          await statAsync(toAbs2);
          return err({ kind: "AlreadyExists", path: to });
        } catch {}
      }
      await mkdir(dirname(toAbs2), { recursive: true });
      try {
        await rename(fromAbs, toAbs2);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOTEMPTY" || code === "EEXIST" || code === "EPERM") {
          return err(
            forbidden(
              `can't overwrite "${to}" — the destination folder is not empty`,
            ),
          );
        }
        throw e;
      }
      return ok({ ok: true });
    },
    deleteSafe: async (
      rel,
    ): Promise<Result<{ ok: true }, FilesDomainError>> => {
      const abs = toWritableAbs(rel);
      if (!abs) return err(forbidden("forbidden path"));
      await rm(abs, { recursive: true, force: false });
      return ok({ ok: true });
    },
    uploadFileSafe: async (
      rel,
      base64,
      overwrite,
    ): Promise<Result<FileWriteOk, FilesDomainError>> => {
      const abs = toWritableAbs(rel);
      if (!abs) return err(forbidden("forbidden path"));
      const buf = Buffer.from(base64, "base64");
      if (buf.length > MAX_FILE_SIZE) {
        return err({
          kind: "PayloadTooLarge",
          detail: `file ${buf.length} bytes (max ${MAX_FILE_SIZE})`,
        });
      }
      if (!overwrite) {
        try {
          await statAsync(abs);
          return err({ kind: "AlreadyExists", path: rel });
        } catch {}
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
      const s = await statAsync(abs);
      return ok({ mtimeMs: s.mtimeMs, absolutePath: abs });
    },
  };
}
