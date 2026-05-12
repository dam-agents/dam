import type { Stats } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract, type ReadEntry } from "tar";

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
 * file or directory, has an absolute path, contains `..`, whose first
 * segment is platform-reserved, or whose final resolved path escapes
 * `stagingDir`, aborts extraction with an error. The caller is responsible
 * for cleaning up `stagingDir` on failure.
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
): Promise<ExtractResult> {
  const root = resolve(stagingDir);
  let filesWritten = 0;
  let bytes = 0;
  let abortReason: Error | undefined;

  // Note: `tar`'s `filter` is called synchronously inside the parser.
  // Throwing from inside it escapes as an uncaught exception. Instead,
  // skip the bad entry (return false) and remember the first reason —
  // we throw after the pipeline completes. The caller deletes the
  // staging dir on failure, so any partial extraction is discarded.
  const sink = extract({
    cwd: root,
    onentry: (entry) => {
      bytes += Number(entry.size ?? 0);
      if (entry.type === "File") filesWritten += 1;
    },
    filter: (path: string, entry: Stats | ReadEntry) => {
      if (!isReadEntry(entry)) return false;
      const reason = validateEntry(path, entry, root);
      if (reason) {
        if (!abortReason) abortReason = new Error(reason);
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

  await pipeline(stream, sink);
  if (abortReason) throw abortReason;
  return { filesWritten, bytes };
}

// `extract`'s filter option is typed `Stats | ReadEntry` because it's
// shared with `create`. At extraction time it's always a ReadEntry —
// `Stats` doesn't have a string `type` field, so this narrows safely.
function isReadEntry(entry: Stats | ReadEntry): entry is ReadEntry {
  return typeof (entry as ReadEntry).type === "string";
}

function validateEntry(path: string, entry: ReadEntry, root: string): string | null {
  if (entry.type !== "File" && entry.type !== "Directory") {
    return `refusing tar entry of type ${entry.type} at ${path}`;
  }
  if (path.startsWith("/")) {
    return `refusing absolute path entry: ${path}`;
  }
  const segments = path.split(/[\\/]/);
  if (segments.some((seg) => seg === "..")) {
    return `refusing path traversal entry: ${path}`;
  }
  for (const seg of segments) {
    if (RESERVED_SEGMENTS.has(seg)) {
      return `refusing reserved path segment ${JSON.stringify(seg)}: ${path}`;
    }
  }
  const final = resolve(root, path);
  if (final !== root && !final.startsWith(root + "/")) {
    return `refusing entry that escapes staging dir: ${path}`;
  }
  return null;
}
