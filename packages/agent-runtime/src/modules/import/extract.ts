import type { Stats } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract, type ReadEntry } from "tar";
import { err, ok, type Result } from "agent-runtime-api";

import type { ImportDomainError } from "./errors.js";

export type ExtractResult = {
  filesWritten: number;
  bytes: number;
};

/**
 * Stream-extract a tar (or tar.gz) bundle into `stagingDir`.
 *
 * Path safety: every entry is validated. Non-file/non-directory entries,
 * absolute paths, paths containing `..`, and paths that resolve outside
 * `stagingDir` return an `InvalidEntry` Err. The caller cleans up
 * `stagingDir` on failure.
 *
 * Permissions: files land at 0o666 and dirs at 0o777 regardless of source
 * mode — the non-root agent shares the PVC with the import landing path,
 * so locked-down source modes would leave imported files un-editable.
 * Mirrors `modules/pod-files/apply.ts`.
 */
export async function extractBundle(
  stream: Readable,
  stagingDir: string,
): Promise<Result<ExtractResult, ImportDomainError>> {
  const root = resolve(stagingDir);
  let filesWritten = 0;
  let bytes = 0;
  let firstError: ImportDomainError | undefined;

  // tar's `filter` runs synchronously inside the parser — throwing escapes
  // as an uncaught exception. Skip the bad entry and remember the first
  // error to return after the pipeline completes; the caller deletes the
  // staging dir on failure, so any partial extraction is discarded.
  const sink = extract({
    cwd: root,
    onentry: (entry) => {
      bytes += Number(entry.size ?? 0);
      if (entry.type === "File") filesWritten += 1;
    },
    filter: (path: string, entry: Stats | ReadEntry) => {
      if (!isReadEntry(entry)) return false;
      const error = validateEntry(path, entry, root);
      if (error) {
        if (!firstError) firstError = error;
        return false;
      }
      return true;
    },
    strict: true,
    preservePaths: false,
    chmod: true,
    fmode: 0o666,
    dmode: 0o777,
  });

  try {
    await pipeline(stream, sink);
  } catch (e) {
    return err({ kind: "TarParseError", detail: (e as Error).message });
  }
  if (firstError) return err(firstError);
  return ok({ filesWritten, bytes });
}

function isReadEntry(entry: Stats | ReadEntry): entry is ReadEntry {
  return typeof (entry as ReadEntry).type === "string";
}

const WINDOWS_ABS_RE = /^([A-Za-z]:[\\/]|\\\\)/;

function validateEntry(path: string, entry: ReadEntry, root: string): ImportDomainError | null {
  if (entry.type !== "File" && entry.type !== "Directory") {
    return { kind: "InvalidEntry", path, reason: `unsupported tar entry type ${entry.type}` };
  }
  if (path.startsWith("/") || WINDOWS_ABS_RE.test(path)) {
    return { kind: "InvalidEntry", path, reason: "absolute path" };
  }
  const segments = path.split(/[\\/]/);
  if (segments.some((seg) => seg === "..")) {
    return { kind: "InvalidEntry", path, reason: "path traversal" };
  }
  const final = resolve(root, path);
  if (final !== root && !final.startsWith(root + "/")) {
    return { kind: "InvalidEntry", path, reason: "escapes staging dir" };
  }
  return null;
}
