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

export async function extractBundle(
  stream: Readable,
  stagingDir: string,
): Promise<Result<ExtractResult, ImportDomainError>> {
  const root = resolve(stagingDir);
  let filesWritten = 0;
  let bytes = 0;
  let firstError: ImportDomainError | undefined;

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

function validateEntry(
  path: string,
  entry: ReadEntry,
  root: string,
): ImportDomainError | null {
  if (entry.type !== "File" && entry.type !== "Directory") {
    return {
      kind: "InvalidEntry",
      path,
      reason: `unsupported tar entry type ${entry.type}`,
    };
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
