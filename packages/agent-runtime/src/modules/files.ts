import { dirname, join, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat as statAsync, writeFile } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import type {
  FileReadResult,
  FilesDomainError,
  FilesService,
  FileWriteOk,
  Result,
} from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";

const EXCLUDE = new Set([".git", ".npm", ".triggers", ".claude.json", ".initialized", "node_modules", ".DS_Store"]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Fallback check for binary content when magic-byte detection fails. Null bytes in the first 8 KB are a reliable signal. */
function hasNullBytes(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

function buildTree(
  dir: string,
  base = "",
): { path: string; type: "file" | "dir" }[] {
  const entries: { path: string; type: "file" | "dir" }[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(ent.name)) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      entries.push({ path: rel, type: "dir" });
      entries.push(...buildTree(join(dir, ent.name), rel));
    } else {
      entries.push({ path: rel, type: "file" });
    }
  }
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

function safePath(workingDir: string, rel: string): string | null {
  const resolved = resolve(workingDir, rel);
  if (!resolved.startsWith(resolve(workingDir))) return null;
  return resolved;
}

/** Every segment of a writable path must be outside the EXCLUDE set — this
 *  blocks writes into .git/*, node_modules/*, and the like even though those
 *  are invisible to the tree. Empty / traversal segments are rejected so the
 *  caller can return a safe error without relying on safePath alone. */
function isWritablePath(rel: string): boolean {
  if (!rel) return false;
  const parts = rel.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") return false;
    if (EXCLUDE.has(part)) return false;
  }
  return true;
}

const forbidden = (reason: string): FilesDomainError => ({ kind: "Forbidden", reason });

export function createFilesService(workingDir: string): FilesService {
  const toAbs = (rel: string): string | null => safePath(workingDir, rel);
  const toWritableAbs = (rel: string): string | null => {
    if (!isWritablePath(rel)) return null;
    return toAbs(rel);
  };

  return {
    buildTree: () => buildTree(workingDir),
    readFileSafe: async (rel): Promise<Result<FileReadResult, FilesDomainError>> => {
      if (!rel) return err({ kind: "NotFound", path: rel });
      const abs = toAbs(rel);
      if (!abs) return err({ kind: "NotFound", path: rel });
      try {
        const s = await statAsync(abs);
        if (!s.isFile()) return err({ kind: "NotFound", path: rel });
        if (s.size > MAX_FILE_SIZE) {
          return ok({ path: rel, binary: true });
        }
        const type = await fileTypeFromFile(abs);
        const buf = await readFile(abs);
        const mtimeMs = s.mtimeMs;
        if (type) {
          return ok({ path: rel, content: buf.toString("base64"), binary: true, mimeType: type.mime, mtimeMs });
        }
        // file-type only detects known binary formats. Fall back to null-byte check
        // to catch unknown binary formats (raw .bin dumps, proprietary formats, etc.)
        if (hasNullBytes(buf)) {
          return ok({ path: rel, content: buf.toString("base64"), binary: true, mimeType: "application/octet-stream", mtimeMs });
        }
        const content = buf.toString("utf8");
        const lower = rel.toLowerCase();
        const mimeType =
          lower.endsWith(".svg") ? "image/svg+xml" :
          lower.endsWith(".json") || lower.endsWith(".jsonl") ? "application/json" :
          lower.endsWith(".csv") ? "text/csv" :
          lower.endsWith(".html") || lower.endsWith(".htm") ? "text/html" :
          lower.endsWith(".md") || lower.endsWith(".mdx") ? "text/markdown" :
          lower.endsWith(".xml") ? "application/xml" :
          "text/plain";
        return ok({ path: rel, content, mimeType, mtimeMs });
      } catch {
        return err({ kind: "NotFound", path: rel });
      }
    },
    writeFileSafe: async (rel, content, expectedMtimeMs): Promise<Result<FileWriteOk, FilesDomainError>> => {
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
    createFileSafe: async (rel, content): Promise<Result<FileWriteOk, FilesDomainError>> => {
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
    renameSafe: async (from, to, overwrite): Promise<Result<{ ok: true }, FilesDomainError>> => {
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
    deleteSafe: async (rel): Promise<Result<{ ok: true }, FilesDomainError>> => {
      const abs = toWritableAbs(rel);
      if (!abs) return err(forbidden("forbidden path"));
      await rm(abs, { recursive: true, force: false });
      return ok({ ok: true });
    },
    uploadFileSafe: async (rel, base64, overwrite): Promise<Result<FileWriteOk, FilesDomainError>> => {
      const abs = toWritableAbs(rel);
      if (!abs) return err(forbidden("forbidden path"));
      const buf = Buffer.from(base64, "base64");
      if (buf.length > MAX_FILE_SIZE) {
        return err({ kind: "PayloadTooLarge", detail: `file ${buf.length} bytes (max ${MAX_FILE_SIZE})` });
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
