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
 * Path segments the platform owns. Bundles that target any of these
 * are refused; importing them would corrupt control-plane state — the
 * trigger queue actively written by the controller, or the pod boot
 * marker the platform reads on start.
 *
 * Narrower than `FilesService.EXCLUDE` on purpose: that set covers what
 * shouldn't be hand-edited via the file panel (`.git/`, `node_modules/`,
 * `.claude.json`, etc.). Import is the user explicitly bringing context
 * at create-time when nothing is running yet, so it can include user
 * state files (`.git/`, `.claude.json`) that the file editor protects
 * from live edits. Junk filtering for ergonomics lives client-side.
 */
const RESERVED_SEGMENTS = new Set([
  ".triggers",
  ".initialized",
]);

/**
 * Stream-extract a tar (or tar.gz) bundle into `stagingDir`.
 *
 * Path safety: every entry is validated. Any entry that is not a regular
 * file or directory, has an absolute path (POSIX or Windows-style),
 * contains `..`, whose first segment is platform-reserved, or whose final
 * resolved path escapes `stagingDir`, returns an `InvalidEntry` /
 * `ReservedSegment` Err. The caller is responsible for cleaning up
 * `stagingDir` on failure.
 *
 * Permissions: files land at 0o666 and directories at 0o777, regardless
 * of the source mode. The non-root agent process shares the PVC with
 * the import landing path; locked-down source modes would otherwise leave
 * imported files un-editable from inside the pod. Mirrors the convention
 * in `modules/pod-files/apply.ts`.
 */
export async function extractBundle(
  stream: Readable,
  stagingDir: string,
): Promise<Result<ExtractResult, ImportDomainError>> {
  const root = resolve(stagingDir);
  let filesWritten = 0;
  let bytes = 0;
  let firstError: ImportDomainError | undefined;

  // Note: `tar`'s `filter` is called synchronously inside the parser.
  // Throwing from inside it escapes as an uncaught exception. Instead,
  // skip the bad entry (return false) and remember the first error —
  // we return it after the pipeline completes. The caller deletes the
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

// `extract`'s filter option is typed `Stats | ReadEntry` because it's
// shared with `create`. At extraction time it's always a ReadEntry —
// `Stats` doesn't have a string `type` field, so this narrows safely.
function isReadEntry(entry: Stats | ReadEntry): entry is ReadEntry {
  return typeof (entry as ReadEntry).type === "string";
}

// Windows-style absolute path prefixes. We're a Linux runtime, so these
// would be treated as literal segments by node:path/resolve, not as
// absolute paths — but a tar containing them is a clear sign of crafted
// input, so refuse them up front.
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
  for (const seg of segments) {
    if (RESERVED_SEGMENTS.has(seg)) {
      return { kind: "ReservedSegment", path, segment: seg };
    }
  }
  const final = resolve(root, path);
  if (final !== root && !final.startsWith(root + "/")) {
    return { kind: "InvalidEntry", path, reason: "escapes staging dir" };
  }
  return null;
}
