import type { Result } from "../../result.js";

export interface DirEntry {
  name: string;
  type: "file" | "dir";
}

export type DirListResult =
  | { path: string; ok: true; entries: DirEntry[] }
  | { path: string; ok: false; error: "not-found" | "forbidden" };

export interface FileReadResult {
  path: string;
  content: string;
  binary: boolean;
  mimeType: string;
  mtimeMs: number;
}

export interface FileWriteOk {
  mtimeMs: number;
  /** Absolute on-pod path. Exposed for callers (e.g., chat-message uploads)
   *  that need to hand the path to the agent as a `file://` URI. */
  absolutePath?: string;
}

export type FilesDomainError =
  | { kind: "Forbidden"; reason: string }
  | { kind: "NotFound"; path: string }
  | { kind: "Conflict"; currentMtimeMs: number }
  | { kind: "AlreadyExists"; path: string }
  | { kind: "PayloadTooLarge"; detail: string };

export interface FilesService {
  /** Snapshot a set of directories in one call. Each path's outcome is
   *  reported independently — one missing dir does not abort the batch.
   *  Empty string lists the working-directory root. */
  listDirs: (paths: string[]) => Promise<DirListResult[]>;
  readFileSafe: (
    rel: string,
  ) => Promise<Result<FileReadResult, FilesDomainError>>;
  /** Overwrite an existing file. Errors with Conflict when expectedMtimeMs is
   *  provided and the file was modified in the meantime. */
  writeFileSafe: (
    rel: string,
    content: string,
    expectedMtimeMs?: number,
  ) => Promise<Result<FileWriteOk, FilesDomainError>>;
  /** Create a new file. Errors with AlreadyExists when the path is taken.
   *  Auto-creates missing parent directories. */
  createFileSafe: (
    rel: string,
    content: string,
  ) => Promise<Result<FileWriteOk, FilesDomainError>>;
  /** Create a directory (recursive mkdir). */
  mkdirSafe: (rel: string) => Promise<Result<{ ok: true }, FilesDomainError>>;
  /** Move/rename a file or directory. Errors with AlreadyExists when the
   *  destination exists and overwrite is false. */
  renameSafe: (
    from: string,
    to: string,
    overwrite: boolean,
  ) => Promise<Result<{ ok: true }, FilesDomainError>>;
  deleteSafe: (rel: string) => Promise<Result<{ ok: true }, FilesDomainError>>;
  /** Write a binary payload (base64-encoded) to disk. Intended for UI
   *  uploads where the client has no prior mtime. */
  uploadFileSafe: (
    rel: string,
    base64: string,
    overwrite: boolean,
  ) => Promise<Result<FileWriteOk, FilesDomainError>>;
}
