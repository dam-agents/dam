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
  absolutePath?: string;
}

export type FilesDomainError =
  | { kind: "Forbidden"; reason: string }
  | { kind: "NotFound"; path: string }
  | { kind: "Conflict"; currentMtimeMs: number }
  | { kind: "AlreadyExists"; path: string }
  | { kind: "PayloadTooLarge"; detail: string };

export interface FilesService {
  listDirs: (paths: string[]) => Promise<DirListResult[]>;
  readFileSafe: (
    rel: string,
  ) => Promise<Result<FileReadResult, FilesDomainError>>;
  writeFileSafe: (
    rel: string,
    content: string,
    expectedMtimeMs?: number,
  ) => Promise<Result<FileWriteOk, FilesDomainError>>;
  createFileSafe: (
    rel: string,
    content: string,
  ) => Promise<Result<FileWriteOk, FilesDomainError>>;
  mkdirSafe: (rel: string) => Promise<Result<{ ok: true }, FilesDomainError>>;
  renameSafe: (
    from: string,
    to: string,
    overwrite: boolean,
  ) => Promise<Result<{ ok: true }, FilesDomainError>>;
  deleteSafe: (rel: string) => Promise<Result<{ ok: true }, FilesDomainError>>;
  uploadFileSafe: (
    rel: string,
    base64: string,
    overwrite: boolean,
  ) => Promise<Result<FileWriteOk, FilesDomainError>>;
}
