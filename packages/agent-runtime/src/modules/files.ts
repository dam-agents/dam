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

// Wire-level per-file cap for tRPC-shaped reads and uploads. The transport
// is JSON-base64 — ~10 MB fits well below the 32 MB tRPC body ceiling.
// Larger transfers want a streaming endpoint, not this surface.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Platform-reserved paths under the working directory. The controller writes
 *  trigger payloads to `.triggers/` (ADR-008) and uses `.initialized` as a
 *  setup marker; user reads/writes against either would break agent lifecycle.
 *  See ADR-050. Repo noise (.git, node_modules, .DS_Store, …) is surfaceable. */
const RESERVED = new Set([".triggers", ".initialized"]);

/** Fallback check for binary content when magic-byte detection fails. Null bytes in the first 8 KB are a reliable signal. */
function hasNullBytes(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

function safePath(workingDir: string, rel: string): string | null {
  const resolved = resolve(workingDir, rel);
  if (!resolved.startsWith(resolve(workingDir))) return null;
  return resolved;
}

/** True when any segment of the path hits the reserved set. Listing or
 *  writing such a path is refused server-side. */
function touchesReserved(rel: string): boolean {
  if (!rel) return false;
  return rel.split("/").some((seg) => RESERVED.has(seg));
}

/** Every segment of a writable path must be outside the reserved set and
 *  must be a real segment (no traversal, no empties). */
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
      .filter((ent) => !RESERVED.has(ent.name))
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
  const toAbs = (rel: string): string | null => safePath(workingDir, rel);
  const toWritableAbs = (rel: string): string | null => {
    if (!isWritablePath(rel)) return null;
    return toAbs(rel);
  };

  return {
    listDirs: (paths) => Promise.all(paths.map((p) => listDir(workingDir, p))),
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
          // Reading a file over the tRPC-shaped cap is a transport
          // constraint, not a successful "no content" read. Surfaces as
          // PAYLOAD_TOO_LARGE at the router, matching the symmetric
          // behavior of uploadFileSafe. Streaming transfer for large
          // single files is out of scope for this route.
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
        // Optimistic concurrency: refuse to clobber if the file changed under
        // us. A missing file is treated as a conflict rather than a silent
        // create — createFileSafe is the right call for net-new writes.
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
        // `wx` fails when the path exists — we want "create" to be strict so
        // the UI can prompt for an alternative name instead of clobbering.
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
      } catch {
        // Does not exist — create it.
      }
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
        } catch {
          // destination is free
        }
      }
      await mkdir(dirname(toAbs2), { recursive: true });
      await rename(fromAbs, toAbs2);
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
        } catch {
          // destination is free
        }
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
      const s = await statAsync(abs);
      return ok({ mtimeMs: s.mtimeMs, absolutePath: abs });
    },
  };
}
