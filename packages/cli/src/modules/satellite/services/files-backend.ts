import { createHash } from "node:crypto";
import { statfsSync } from "node:fs";
import { unlink, type FileHandle } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  MAX_JOB_OUTPUT_BYTES,
  SATELLITE_FILE_MAX_BYTES,
  type SatelliteTool,
} from "api-server-api";
import { extract as tarExtract, pack as tarPack } from "tar-stream";
import type { CallOutcome, SatelliteBackend } from "./backend.js";
import {
  discardDirInRoot,
  listInRoot,
  lstatInRoot,
  openInRoot,
  pathSegments,
  publishDirInRoot,
  publishInRoot,
  stageDirInRoot,
  stagedDigest,
  stageInRoot,
  walkInRoot,
  type ListCut,
  type ListedEntry,
  type Refusal,
  type Staged,
  type StagedDir,
} from "./confined-files.js";
import type { FileTransfer } from "./file-transfer.js";

export const DOWNLOAD_TOOL = "download";
export const UPLOAD_TOOL = "upload";
export const LIST_TOOL = "list";
export const STAT_TOOL = "stat";

const LIST_DEFAULT_DEPTH = 1;
const LIST_GLOB_DEPTH = 10;
const LIST_MAX_DEPTH = 10;
const LIST_DEFAULT_LIMIT = 500;
const LIST_MAX_LIMIT = 5000;
const LIST_BUDGET_MS = 20_000;
const LIST_MAX_GLOB = 256;
const LIST_OUTPUT_BYTES = MAX_JOB_OUTPUT_BYTES - 48 * 1024;
const TRUNCATION_RESERVE_BYTES = 256;

const DIR_MAX_DEPTH = 32;
const DOWNLOAD_DIR_MAX_FILES = 10_000;
const UNPACK_MAX_ENTRIES = 10_000;
const SKIPPED_LIST_MAX = 50;
const SKIPPED_LIST_BYTES = 16 * 1024;
const ENTRY_LABEL_MAX = 200;
const TAR_END_BYTES = 1024;
const UNPACK_HEADROOM_BYTES = 1024 * 1024 * 1024;
const TAR_HEADER_BYTES = 512;
const TAR_TERMINATOR_BYTES = 1024;

const REFUSALS: Record<Refusal, string> = {
  outside: "is not a place inside the directory this satellite exposes",
  "not-a-file":
    "is not a regular file — it is a link, a directory, or something that is not a file",
  exists: "already exists on this machine — pass overwrite: true to replace it",
  "no-such-file": "does not exist on this machine",
  "not-writable": "cannot be written here",
  changed: "changed while it was being written, so it was not published",
};

function refused(reason: string): CallOutcome {
  return {
    status: "done",
    isError: true,
    exitCode: null,
    output: reason,
    truncated: false,
    blocked: true,
  };
}

function failed(reason: string): CallOutcome {
  return {
    status: "done",
    isError: true,
    exitCode: null,
    output: reason,
    truncated: false,
  };
}

function done(output: Record<string, unknown>): CallOutcome {
  return {
    status: "done",
    isError: false,
    exitCode: null,
    output: JSON.stringify(output),
    truncated: false,
  };
}

class Phrased extends Error {
  constructor(readonly outcome: CallOutcome) {
    super(outcome.output);
  }
}

function freeBytesOn(dir: string): number | null {
  try {
    const stats = statfsSync(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function labelled(name: string): string {
  return JSON.stringify(
    name.length > ENTRY_LABEL_MAX ? `${name.slice(0, ENTRY_LABEL_MAX)}…` : name,
  );
}

function skippedNames(names: readonly string[]): string[] {
  const kept: string[] = [];
  let bytes = 0;
  for (const name of names) {
    const size = Buffer.byteLength(name) + 3;
    if (kept.length >= SKIPPED_LIST_MAX || bytes + size > SKIPPED_LIST_BYTES)
      break;
    kept.push(name);
    bytes += size;
  }
  if (kept.length === names.length) return kept;
  return [...kept, `… and ${names.length - kept.length} more`];
}

function tarBytesAtLeast(files: readonly ListedEntry[]): number {
  return (
    TAR_TERMINATOR_BYTES +
    files.reduce(
      (sum, entry) =>
        sum +
        TAR_HEADER_BYTES +
        Math.ceil((entry.size ?? 0) / TAR_HEADER_BYTES) * TAR_HEADER_BYTES,
      0,
    )
  );
}

function wholeNumber(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A glob over one entry's name relative to the
 * directory that was listed. A `**` segment stands for zero or more segments,
 * `*` and `?` match inside one segment, and there are no braces. The CLI
 * supports Node 20, which has no `path.matchesGlob`, and a regex built from a
 * pattern is open to catastrophic backtracking on names an Agent did not choose —
 * synchronously, so heartbeats, the deadline and cancellation would all stall.
 * Both levels are therefore the two-pointer wildcard walk, quadratic at worst and
 * unable to run away. The pattern only decides what is printed: the walk still
 * descends into every directory the depth allows.
 */
function matchCharacters(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      mark = t;
      continue;
    }
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
      p++;
      t++;
      continue;
    }
    if (star < 0) return false;
    p = star + 1;
    mark++;
    t = mark;
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

function matchSegments(
  pattern: readonly string[],
  name: readonly string[],
): boolean {
  let p = 0;
  let n = 0;
  let star = -1;
  let mark = 0;
  while (n < name.length) {
    const segment = pattern[p];
    if (
      segment !== undefined &&
      segment !== "**" &&
      matchCharacters(segment, name[n] ?? "")
    ) {
      p++;
      n++;
      continue;
    }
    if (segment === "**") {
      star = p++;
      mark = n;
      continue;
    }
    if (star < 0) return false;
    p = star + 1;
    mark++;
    n = mark;
  }
  while (p < pattern.length && pattern[p] === "**") p++;
  return p === pattern.length;
}

function globMatcher(glob: string): (path: string) => boolean {
  const pattern = glob.split("/");
  return (path) => matchSegments(pattern, path.split("/"));
}

interface Slice {
  start: number;
  length: number;
  ranged: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The bytes one download copies, resolved against the
 * size the verified open reported. A negative offset counts back from the end
 * and is clamped to the start, an offset past the end is refused, and the length
 * defaults to the rest of the file. The cap is measured against the slice, so a
 * file larger than the cap still moves in parts.
 */
function sliceOf(
  args: Record<string, unknown>,
  size: number,
  cap: number,
): { ok: true; slice: Slice } | { ok: false; detail: string } {
  let offset: number | undefined;
  let length: number | undefined;
  if (args.offset !== undefined) {
    const given = wholeNumber(args.offset);
    if (given === null)
      return {
        ok: false,
        detail:
          "offset is a whole number of bytes — negative counts back from the end of the file",
      };
    offset = given;
  }
  if (args.length !== undefined) {
    const given = wholeNumber(args.length);
    if (given === null || given <= 0)
      return {
        ok: false,
        detail: "length is a whole number of bytes greater than 0",
      };
    length = given;
  }

  const ranged = offset !== undefined || length !== undefined;
  const start =
    offset === undefined ? 0 : offset < 0 ? Math.max(0, size + offset) : offset;
  if (start > size)
    return {
      ok: false,
      detail: `is shorter than offset ${offset} — the file is ${size} bytes`,
    };
  const rest = size - start;
  const slice: Slice = {
    start,
    length: Math.min(length ?? rest, rest),
    ranged,
  };
  if (slice.length > cap)
    return {
      ok: false,
      detail: ranged
        ? `is ${slice.length} bytes, over the ${cap} byte transfer limit — ask for a shorter length`
        : `is ${size} bytes, over the ${cap} byte transfer limit — pass offset and length to copy part of it`,
    };
  return { ok: true, slice };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads the slice off the descriptor that was
 * verified for this call, never by reopening the path. A part stops at its own
 * length; a whole file is read as it comes and fails the transfer when it hands
 * back more than the size it was measured at, so a file that grows mid-copy is
 * cut off rather than sent in a length the platform did not agree to.
 */
function chunks(
  handle: FileHandle,
  signal: AbortSignal,
  slice: Slice,
): Readable {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let sent = 0;
  const source = new Readable({
    async read() {
      if (signal.aborted) {
        this.destroy(new Error("cancelled"));
        return;
      }
      const want = slice.ranged
        ? Math.min(buffer.length, slice.length - sent)
        : buffer.length;
      if (want === 0) {
        this.push(null);
        return;
      }
      const { bytesRead } = await handle.read(
        buffer,
        0,
        want,
        slice.start + sent,
      );
      if (bytesRead === 0) {
        this.push(null);
        return;
      }
      if (!slice.ranged && sent + bytesRead > slice.length) {
        this.destroy(new Error("too large"));
        return;
      }
      sent += bytesRead;
      this.push(Buffer.from(buffer.subarray(0, bytesRead)));
    },
  });
  source.on("close", () => void handle.close().catch(() => {}));
  return source;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Writes one chunk in full. A regular-file write may
 * write less than it was given, and a transfer that treated a short result as
 * success would publish a file shorter than the one it hashed.
 */
async function writeAll(staged: Staged, bytes: Buffer): Promise<void> {
  let written = 0;
  while (written < bytes.length) {
    const { bytesWritten } = await staged.handle.write(
      bytes,
      written,
      bytes.length - written,
    );
    if (bytesWritten <= 0) throw new Error("the write made no progress");
    written += bytesWritten;
  }
}

async function discardStaged(staged: Staged): Promise<void> {
  await staged.handle.close().catch(() => {});
  await unlink(staged.path).catch(() => {});
}

function downloadTool(root: string, cap: number): SatelliteTool {
  return {
    name: DOWNLOAD_TOOL,
    title: "Copy a file, or part of one, from this machine into your workspace",
    transfer: "download",
    description: [
      `Copy a file, or part of one, from ${root} on this machine into your own workspace.`,
      "The contents do not come back in the result: you get the workspace path the file landed at, its size, the sha256 of what landed, and you open, grep or hash it with your own tools.",
      "path is relative to the directory this machine exposes. A link is refused at any point on the way, even one that points back inside; so is anything that is not a regular file.",
      "offset and length copy part of a file: offset is the first byte, counting from 0, and a negative offset counts back from the end, so -1048576 is the last megabyte; length is how many bytes to copy, and without it the copy runs to the end of the file.",
      `One transfer carries at most ${megabytes(cap)} MB. A whole file over that is refused; a part under it still copies, which is how a larger file moves in pieces.`,
      "A part lands under the file's own name, and the result's offset and fileSize say which part it is.",
      "path may also be a directory: then the whole directory comes down as one uncompressed tar of its regular files, keeping the directory's own name, and the result says format tar with how many files it holds. Unpack it in your workspace with `tar -xf <path> -C <dir>`. Links, special files and hard-linked files are left out and named in the result's skipped, which is bounded by count and by bytes so the result stays small; it takes at most " +
        `${DOWNLOAD_DIR_MAX_FILES} files, ${DIR_MAX_DEPTH} levels deep and the transfer limit in total, which counts the tar's own headers and padding too, and offset or length with a directory is refused.`,
      "Delete what you no longer need from .dam/satellite-files/ in your workspace: nothing removes those files for you.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "The file's path on this machine, relative to the exposed directory, e.g. logs/app.log, or a directory's path to take the directory as one tar.",
        },
        offset: {
          type: "integer",
          description:
            "The first byte to copy, counting from 0; a negative offset counts back from the end of the file, so -1048576 is the last megabyte.",
        },
        length: {
          type: "integer",
          minimum: 1,
          description:
            "How many bytes to copy; the default is to the end of the file.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  };
}

function uploadTool(root: string, cap: number): SatelliteTool {
  return {
    name: UPLOAD_TOOL,
    title:
      "Copy one file, or a whole tar of a directory, from your workspace onto this machine",
    transfer: "upload",
    description: [
      `Copy one file from your workspace to ${root} on this machine.`,
      "path is where it lands, relative to the directory this machine exposes; a missing directory on the way is created, and workspacePath is the file in your own workspace.",
      "An existing file is refused unless overwrite is true.",
      `Files up to ${megabytes(cap)} MB.`,
      "`unpack: true` makes workspacePath an uncompressed tar that you made, e.g. `tar -cf out/reports.tar -C out reports`, and unpacks its entries under path.",
      `path is then a directory that must not exist yet, and one tar makes one directory: overwrite is refused with unpack, because a directory upload never replaces or merges into an existing directory. The tar may hold regular files and directories only — a link, a hard link or a device fails the whole upload — each name once, at most ${UNPACK_MAX_ENTRIES} entries and ${DIR_MAX_DEPTH} levels deep, and its own bytes count against the same transfer limit. An empty but well-formed tar makes an empty directory; a body with no tar in it at all is refused. Nothing is published unless every entry arrives and verifies, and a cancelled Job publishes nothing.`,
      "The result says how many files and directories landed, the bytes and the tar's sha256.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Where the file lands on this machine, relative to the exposed directory, e.g. reports/today.csv — or, with unpack, the directory the tar unpacks into, which must not exist yet.",
        },
        workspacePath: {
          type: "string",
          description:
            "The file in your workspace, e.g. work/report.csv, or the absolute path a download gave you.",
        },
        overwrite: {
          type: "boolean",
          description: "Replace a file that is already there.",
        },
        unpack: {
          type: "boolean",
          description:
            "Treat workspacePath as an uncompressed tar and unpack it under path, which must not exist yet.",
        },
      },
      required: ["path", "workspacePath"],
      additionalProperties: false,
    },
  };
}

function listTool(root: string): SatelliteTool {
  return {
    name: LIST_TOOL,
    title: "List what is inside one directory on this machine",
    description: [
      `List what is inside ${root} on this machine, one entry per line.`,
      "Each line is tab-separated: kind, size, mtime in UTC and a JSON string holding the path relative to the directory you listed, so a name with a tab, a newline or a quote reads back exactly. A directory's path ends with a slash inside that string, kind is file, dir, link or other, and size is - for anything that is not a regular file.",
      "A link is listed as a link and never followed: its target is not shown and nothing behind it is read.",
      "No file contents come back. A listing too big for one message is saved as a file in your workspace and you are given its path.",
      `depth is how many levels to descend, 1 by default and at most ${LIST_MAX_DEPTH}. glob filters what is printed, e.g. **/*.log or *.txt, and implies depth ${LIST_GLOB_DEPTH} unless you set depth. limit caps the entries listed, ${LIST_DEFAULT_LIMIT} by default and ${LIST_MAX_LIMIT} at most.`,
      "A listing stops at its output limit as well, which keeps one result inside what a Job can carry. Entries come in filesystem order, not sorted, and a listing that a bound cut short ends with a truncated line saying which bound it was.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "The directory to list, relative to the exposed directory; the default is that directory itself.",
        },
        depth: {
          type: "integer",
          minimum: 1,
          maximum: LIST_MAX_DEPTH,
          description:
            "How many levels to descend, 1 meaning this directory's own entries.",
        },
        glob: {
          type: "string",
          description:
            'A pattern the printed paths must match, e.g. "**/*.log" for the whole tree or "*.txt" for the listed directory only.',
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: LIST_MAX_LIMIT,
          description: "The most entries to list.",
        },
      },
      additionalProperties: false,
    },
  };
}

function statTool(root: string): SatelliteTool {
  return {
    name: STAT_TOOL,
    title: "Report one file's kind, size, mtime and optional sha256",
    description: [
      `Report what ${root} on this machine holds at one path, without moving it.`,
      "The result is JSON: path, kind, size, mtime in UTC and, when you ask for it, sha256. kind is file, dir, link or other, and size is null for anything that is not a regular file.",
      "A link is reported as a link and never followed. sha256 opens the file the way a download does, so a link and a file with more than one link are refused.",
      "A transfer moves no bytes, so any size can be hashed. sha256 reads the whole file on this machine: on a network mount every byte crosses that link, which is slow for a big file.",
      "If the file changes while it is being hashed, the call is refused instead of reporting a digest of bytes that no longer match its size.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "The path to report, relative to the exposed directory, e.g. dumps/dev-07.img.",
        },
        sha256: {
          type: "boolean",
          description:
            "Read the whole file and report its sha256, which checks a copy made in pieces.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  };
}

function rangeLabel(args: Record<string, unknown>): string {
  if (args.offset === undefined && args.length === undefined) return "";
  return ` [offset ${String(args.offset ?? 0)}+${String(args.length ?? "end")}]`;
}

type ListTruncation = Exclude<ListCut, null> | "size";

function truncatedLine(
  cut: ListTruncation,
  listed: number,
  budgetMs: number,
  outputBytes: number,
): string {
  if (cut === "limit")
    return `… truncated: ${listed} entries listed, more exist — narrow path or glob, or raise limit`;
  if (cut === "time")
    return `… truncated: ${listed} entries listed — the ${Math.round(budgetMs / 1000)} s budget ran out; narrow path or glob`;
  return `… truncated: ${listed} entries listed — the listing reached its ${outputBytes} byte limit; narrow path or glob`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A directory on the user's machine, offered to an
 * agent as tools that never carry contents: one file down into the agent's
 * workspace — whole or as a slice — with `--upload` one file back up, and the two
 * that only report what is there, `list` and `stat`. Read-only unless the user
 * said otherwise, and confined to the root the worker was started with — see
 * `confined-files.ts` for what a path must survive before it is opened or
 * walked.
 *
 * The bytes are counted while they move in both directions, so a file that
 * grows after it was measured, or a response that never ends, is cut off at the
 * limit instead of being read whole. What a call reports is a path, a size and a
 * sha256; the file's contents never reach the Agent's context, this process's
 * log, or an error message.
 */
export function createFilesBackend(input: {
  root: string;
  allowUpload: boolean;
  transfer: FileTransfer;
  maxBytes?: number;
  listBudgetMs?: number;
  listOutputBytes?: number;
  freeBytes?: (dir: string) => number | null;
}): SatelliteBackend {
  const cap = input.maxBytes ?? SATELLITE_FILE_MAX_BYTES;
  const budget = input.listBudgetMs ?? LIST_BUDGET_MS;
  const outputBytes = input.listOutputBytes ?? LIST_OUTPUT_BYTES;
  const freeSpace = input.freeBytes ?? freeBytesOn;
  const running = new Map<number, AbortController>();

  async function downloadDirectory(
    sequence: number,
    given: string,
    args: Record<string, unknown>,
    token: string,
    segments: readonly string[],
    signal: AbortSignal,
  ): Promise<CallOutcome> {
    if (args.offset !== undefined || args.length !== undefined)
      return refused(
        `${given} is a directory — offset and length copy part of one file, not a directory`,
      );

    const walked = await listInRoot(input.root, segments, {
      depth: DIR_MAX_DEPTH + 1,
      limit: DOWNLOAD_DIR_MAX_FILES,
      deadline: Date.now() + budget,
      matches: () => true,
      signal,
    });
    if (!walked.ok) return refused(`${given} ${REFUSALS[walked.reason]}`);
    if (walked.cut === "limit")
      return refused(
        `${given} holds more than ${DOWNLOAD_DIR_MAX_FILES} entries within ${DIR_MAX_DEPTH} levels — download a narrower directory`,
      );
    if (walked.cut === "time")
      return refused(
        `${given} took longer than ${Math.round(budget / 1000)} s to walk — download a narrower directory`,
      );
    if (
      walked.entries.some(
        (entry) => entry.path.split("/").length > DIR_MAX_DEPTH,
      )
    )
      return refused(
        `${given} has entries deeper than ${DIR_MAX_DEPTH} levels — download a narrower directory`,
      );

    const files = walked.entries.filter(
      (entry) => entry.kind === "file" && entry.nlink <= 1,
    );
    const skipped = walked.entries
      .filter(
        (entry) =>
          entry.kind === "link" ||
          entry.kind === "other" ||
          (entry.kind === "file" && entry.nlink > 1),
      )
      .map((entry) =>
        entry.kind === "file"
          ? `${entry.path} (hard link)`
          : `${entry.path} (${entry.kind === "link" ? "link" : "other"})`,
      );
    const total = files.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
    if (total > cap)
      return refused(
        `${given} holds ${total} bytes of files, over the ${cap} byte transfer limit — download a subdirectory`,
      );
    const estimate = tarBytesAtLeast(files);
    if (estimate > cap)
      return refused(
        `${given} would come down as at least ${estimate} bytes of tar, over the ${cap} byte transfer limit — download a subdirectory`,
      );

    const pack = tarPack();
    let streamed = 0;
    let encoded = 0;
    let included = 0;
    let streaming = true;
    let failure: unknown = null;
    const encodedStream = Readable.from(pack);
    const counting = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        encoded += chunk.length;
        if (encoded > cap) {
          callback(new Error("too large"));
          return;
        }
        callback(null, chunk);
      },
    });
    const encoding = pipeline(encodedStream, counting).catch(() => {});
    const feeding = (async () => {
      for (const entry of files) {
        if (signal.aborted) throw new Error("cancelled");
        const path = [...segments, ...entry.path.split("/")];
        const file = await openInRoot(input.root, path);
        if (!file.ok) {
          if (file.reason === "no-such-file") {
            skipped.push(`${entry.path} (gone)`);
            continue;
          }
          const again =
            file.reason === "not-a-file"
              ? await lstatInRoot(input.root, path)
              : null;
          if (again === null) throw new Error("changed");
          if (!again.ok) throw new Error("changed");
          if (again.facts.kind === "dir") throw new Error("changed");
          skipped.push(
            `${entry.path} (${again.facts.kind === "file" ? "hard link" : again.facts.kind === "link" ? "link" : "other"})`,
          );
          continue;
        }
        let handedOff = false;
        try {
          const info = await file.handle.stat();
          streamed += info.size;
          if (streamed > cap) {
            throw new Phrased(
              failed(
                `${given} grew over the ${cap} byte transfer limit while it was being copied — download a subdirectory`,
              ),
            );
          }
          included += 1;
          const sink = pack.entry({
            name: entry.path,
            size: info.size,
            mode: (info.mode & 0o100) === 0 ? 0o644 : 0o755,
            mtime: new Date(info.mtimeMs),
          });
          const source = chunks(file.handle, signal, {
            start: 0,
            length: info.size,
            ranged: true,
          });
          handedOff = true;
          try {
            await pipeline(source, sink);
          } catch (err) {
            if (!streaming || signal.aborted) throw err;
            throw new Phrased(
              failed(`${given} changed while it was being copied`),
            );
          }
        } finally {
          if (!handedOff) await file.handle.close().catch(() => {});
        }
      }
      pack.finalize();
    })().catch((err: unknown) => {
      failure = err;
      if (!pack.destroying)
        pack.destroy(err instanceof Error ? err : undefined);
    });

    try {
      const written = await input.transfer.send({
        sequence,
        token,
        bytes: counting,
        signal,
      });
      await Promise.all([feeding, encoding]);
      if (failure !== null) throw failure;
      return done({
        ...written,
        format: "tar",
        files: included,
        skipped: skippedNames(skipped),
      });
    } catch (err) {
      streaming = false;
      if (!pack.destroying) pack.destroy();
      await Promise.all([feeding, encoding]);
      if (signal.aborted) throw err;
      if (failure instanceof Phrased) return failure.outcome;
      if (encoded > cap)
        return failed(
          `${given} comes down as ${encoded} bytes of tar, over the ${cap} byte transfer limit — download a subdirectory`,
        );
      throw err;
    }
  }

  async function download(
    sequence: number,
    args: Record<string, unknown>,
    token: string | undefined,
    signal: AbortSignal,
  ): Promise<CallOutcome> {
    const segments = pathSegments(args.path);
    if (segments === null)
      return refused(
        "path must be the file's path on this machine, relative to the directory it exposes",
      );
    if (token === undefined)
      return failed("this job was claimed without a transfer token");

    const opened = await openInRoot(input.root, segments);
    if (!opened.ok) {
      if (opened.reason === "not-a-file") {
        const facts = await lstatInRoot(input.root, segments);
        if (facts.ok && facts.facts.kind === "dir")
          return downloadDirectory(
            sequence,
            String(args.path),
            args,
            token,
            segments,
            signal,
          );
      }
      return refused(`${String(args.path)} ${REFUSALS[opened.reason]}`);
    }

    const sliced = sliceOf(args, opened.size, cap);
    if (!sliced.ok) {
      await opened.handle.close().catch(() => {});
      return refused(`${String(args.path)} ${sliced.detail}`);
    }

    const written = await input.transfer.send({
      sequence,
      token,
      bytes: chunks(opened.handle, signal, sliced.slice),
      declaredBytes: sliced.slice.length,
      signal,
    });
    return done(
      sliced.slice.ranged
        ? { ...written, offset: sliced.slice.start, fileSize: opened.size }
        : written,
    );
  }

  async function list(
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallOutcome> {
    const segments = args.path === undefined ? [] : pathSegments(args.path);
    if (segments === null)
      return refused(
        "path must be a directory on this machine, relative to the directory it exposes",
      );

    const glob = args.glob;
    if (
      glob !== undefined &&
      (typeof glob !== "string" || glob === "" || glob.length > LIST_MAX_GLOB)
    )
      return refused('glob is a pattern like "**/*.log" or "*.txt"');
    const match = glob === undefined ? null : globMatcher(glob);

    let depth = glob === undefined ? LIST_DEFAULT_DEPTH : LIST_GLOB_DEPTH;
    if (args.depth !== undefined) {
      const given = wholeNumber(args.depth);
      if (given === null || given < 1 || given > LIST_MAX_DEPTH)
        return refused(`depth is a whole number from 1 to ${LIST_MAX_DEPTH}`);
      depth = given;
    }

    let limit = LIST_DEFAULT_LIMIT;
    if (args.limit !== undefined) {
      const given = wholeNumber(args.limit);
      if (given === null || given < 1 || given > LIST_MAX_LIMIT)
        return refused(`limit is a whole number from 1 to ${LIST_MAX_LIMIT}`);
      limit = given;
    }

    const listed = await listInRoot(input.root, segments, {
      depth,
      limit,
      deadline: Date.now() + budget,
      matches: ({ path }) => match === null || match(path),
      signal,
    });
    if (!listed.ok)
      return refused(`${String(args.path ?? ".")} ${REFUSALS[listed.reason]}`);

    const header = "kind\tsize\tmtime\tpath";
    const lines = [header];
    let used = Buffer.byteLength(header);
    let cut: ListTruncation | null = listed.cut;
    for (const entry of listed.entries) {
      const path = JSON.stringify(
        entry.kind === "dir" ? `${entry.path}/` : entry.path,
      );
      const line = `${entry.kind}\t${entry.size ?? "-"}\t${isoSeconds(entry.mtimeMs)}\t${path}`;
      const bytes = Buffer.byteLength(line) + 1;
      if (used + bytes > outputBytes - TRUNCATION_RESERVE_BYTES) {
        cut = "size";
        break;
      }
      lines.push(line);
      used += bytes;
    }
    if (cut !== null)
      lines.push(truncatedLine(cut, lines.length - 1, budget, outputBytes));
    return {
      status: "done",
      isError: false,
      exitCode: null,
      output: lines.join("\n"),
      truncated: false,
    };
  }

  async function stat(
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallOutcome> {
    const segments = pathSegments(args.path);
    if (segments === null)
      return refused(
        "path must be the path on this machine, relative to the directory it exposes",
      );
    const path = String(args.path);

    if (args.sha256 !== true) {
      const read = await lstatInRoot(input.root, segments);
      if (!read.ok) return refused(`${path} ${REFUSALS[read.reason]}`);
      return done({
        path,
        kind: read.facts.kind,
        size: read.facts.size,
        mtime: isoSeconds(read.facts.mtimeMs),
      });
    }

    const opened = await openInRoot(input.root, segments);
    if (!opened.ok) return refused(`${path} ${REFUSALS[opened.reason]}`);
    try {
      const before = await opened.handle.stat();
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let read = 0;
      while (read < before.size) {
        if (signal.aborted) throw new Error("cancelled");
        const { bytesRead } = await opened.handle.read(
          buffer,
          0,
          Math.min(buffer.length, before.size - read),
          read,
        );
        if (signal.aborted) throw new Error("cancelled");
        if (bytesRead === 0) break;
        read += bytesRead;
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = await opened.handle.stat();
      if (
        read !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      )
        return failed(`${path} changed while it was being hashed`);
      return done({
        path,
        kind: "file",
        size: before.size,
        mtime: isoSeconds(before.mtimeMs),
        sha256: hash.digest("hex"),
      });
    } finally {
      await opened.handle.close().catch(() => {});
    }
  }

  async function uploadDirectory(
    sequence: number,
    given: string,
    segments: readonly string[],
    token: string,
    signal: AbortSignal,
  ): Promise<CallOutcome> {
    const parent = await walkInRoot(input.root, segments.slice(0, -1), true);
    if (!parent.ok) return refused(`${given} ${REFUSALS[parent.reason]}`);
    if ((await lstatInRoot(input.root, segments)).ok)
      return refused(
        `${given} already exists on this machine — a directory upload never replaces or merges into an existing directory; choose a new path`,
      );

    let stream: Readable | null = null;
    let staged: StagedDir | null = null;
    let streamError: unknown = null;
    let drained: Promise<void> = Promise.resolve();
    let archived = 0;
    try {
      const incoming = await input.transfer.receive({
        sequence,
        token,
        signal,
      });
      stream = incoming.stream;
      const free = freeSpace(parent.path);
      if (free !== null && free < incoming.size + UNPACK_HEADROOM_BYTES)
        throw new Phrased(
          refused(
            `${given} needs ${megabytes(incoming.size + UNPACK_HEADROOM_BYTES)} MB free where it would land, and this machine has ${megabytes(free)} MB`,
          ),
        );

      const created = await stageDirInRoot(input.root, segments);
      if (!created.ok)
        throw new Phrased(refused(`${given} ${REFUSALS[created.reason]}`));
      staged = created.staged;
      const unpackRoot = created.staged.path;

      const tar = createHash("sha256");
      let tail = Buffer.alloc(0);
      const hashing = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          archived += chunk.length;
          tail = Buffer.concat([tail, chunk.subarray(-TAR_END_BYTES)]).subarray(
            -TAR_END_BYTES,
          );
          if (archived > cap) {
            callback(new Error("too large"));
            return;
          }
          tar.update(chunk);
          callback(null, chunk);
        },
      });
      const extract = tarExtract();
      drained = pipeline(incoming.stream, hashing, extract).catch(
        (err: unknown) => {
          streamError = err;
        },
      );

      let files = 0;
      let dirs = 0;
      let bytes = 0;
      let entries = 0;
      const named = new Set<string>();
      for await (const entry of extract) {
        if (signal.aborted) throw new Error("cancelled");
        entries += 1;
        if (entries > UNPACK_MAX_ENTRIES)
          throw new Phrased(
            refused(
              `${given} was not unpacked: the tar carries more than ${UNPACK_MAX_ENTRIES} entries`,
            ),
          );

        const type = entry.header.type;
        const rawName = entry.header.name;
        if (
          type !== "file" &&
          type !== "contiguous-file" &&
          type !== "directory"
        )
          throw new Phrased(
            refused(
              `${given} was not unpacked: entry ${labelled(rawName)} is a ${type ?? "unknown"} — a directory upload creates regular files and directories only`,
            ),
          );
        const entryName =
          type === "directory" ? rawName.replace(/\/$/, "") : rawName;
        if (type === "directory" && entry.header.size > 0)
          throw new Phrased(
            refused(
              `${given} was not unpacked: directory entry ${labelled(entryName)} declares ${entry.header.size} bytes — a directory holds no content`,
            ),
          );
        const target = pathSegments(entryName);
        if (target === null)
          throw new Phrased(
            refused(
              `${given} was not unpacked: entry ${labelled(entryName)} is not a relative path inside it — no absolute path, no .., no empty segment and no backslash`,
            ),
          );
        if (target.length > DIR_MAX_DEPTH)
          throw new Phrased(
            refused(
              `${given} was not unpacked: entry ${labelled(entryName)} is ${target.length} levels deep, over the ${DIR_MAX_DEPTH} level limit`,
            ),
          );
        if (named.has(entryName))
          throw new Phrased(
            refused(
              `${given} was not unpacked: entry ${labelled(entryName)} appears twice — every entry takes a name of its own`,
            ),
          );
        named.add(entryName);

        if (type === "directory") {
          const made = await walkInRoot(unpackRoot, target, true);
          if (!made.ok)
            throw new Phrased(
              refused(
                `${given} was not unpacked: directory entry ${labelled(entryName)} ${REFUSALS[made.reason]}`,
              ),
            );
          dirs += 1;
          entry.resume();
          continue;
        }

        if (bytes + entry.header.size > cap)
          throw new Phrased(
            failed(
              `${given} was not unpacked: it unpacks to more than the ${cap} byte transfer limit`,
            ),
          );
        const file = await stageInRoot(unpackRoot, target);
        if (!file.ok)
          throw new Phrased(
            refused(
              `${given} was not unpacked: file entry ${labelled(entryName)} ${REFUSALS[file.reason]}`,
            ),
          );
        let handedOff = false;
        try {
          const carried = createHash("sha256");
          let received = 0;
          for await (const chunk of entry) {
            if (signal.aborted) throw new Error("cancelled");
            const part = chunk as Buffer;
            received += part.length;
            bytes += part.length;
            if (bytes > cap)
              throw new Phrased(
                failed(
                  `${given} was not unpacked: it unpacks to more than the ${cap} byte transfer limit`,
                ),
              );
            carried.update(part);
            await writeAll(file.staged, part);
          }

          try {
            await file.staged.handle.chmod(
              (entry.header.mode & 0o100) === 0 ? 0o600 : 0o700,
            );
          } catch {
            throw new Phrased(
              failed(
                `${given} was not unpacked: this machine could not set the mode of ${labelled(entryName)}`,
              ),
            );
          }
          if (signal.aborted) throw new Error("cancelled");
          const onDisk = await stagedDigest(file.staged);
          if (
            onDisk === null ||
            onDisk.size !== received ||
            onDisk.sha256 !== carried.digest("hex")
          )
            throw new Phrased(
              failed(
                `${given} was not unpacked: what reached this machine is not what the tar carried for ${labelled(entryName)}`,
              ),
            );
          if (signal.aborted) throw new Error("cancelled");
          const published = await publishInRoot(unpackRoot, file.staged, false);
          handedOff = true;
          if (signal.aborted) throw new Error("cancelled");
          if (published !== null)
            throw new Phrased(
              refused(
                `${given} was not unpacked: entry ${labelled(entryName)} ${REFUSALS[published]}`,
              ),
            );
          files += 1;
        } finally {
          if (!handedOff) await discardStaged(file.staged);
        }
      }

      await drained;
      if (streamError !== null) throw streamError;
      if (signal.aborted) throw new Error("cancelled");
      if (archived === 0)
        throw new Phrased(
          failed(
            `${given} was not unpacked: the upload was empty — send a tar of the directory`,
          ),
        );
      /**
       * UNIT_BOUNDARY_DESCRIPTION: A tar that ends between two entries parses
       * cleanly up to the cut, so the parser alone would publish part of the
       * tree. Every byte the workspace declared must have arrived, and the body
       * must end in the two zero blocks that close every tar.
       */
      if (
        archived !== incoming.size ||
        tail.length < TAR_END_BYTES ||
        tail.some((byte) => byte !== 0)
      )
        throw new Phrased(
          failed(
            `${given} was not unpacked: the tar was cut short — ${archived} of ${incoming.size} bytes arrived, or it does not end the way a tar ends`,
          ),
        );

      const published = await publishDirInRoot(input.root, staged);
      if (published !== null) {
        await discardDirInRoot(staged);
        staged = null;
        return refused(`${given} ${REFUSALS[published]}`);
      }
      staged = null;
      return done({
        path: given,
        files,
        dirs,
        bytes,
        sha256: tar.digest("hex"),
      });
    } catch (err) {
      stream?.destroy();
      await drained;
      if (staged !== null) await discardDirInRoot(staged);
      if (signal.aborted)
        return { status: "cancelled", output: "", truncated: false };
      if (err instanceof Phrased) return err.outcome;
      if (archived > cap)
        return failed(
          `${given} was not unpacked: the tar is over the ${cap} byte transfer limit`,
        );
      return failed(
        `${given} was not unpacked: what arrived is not a tar archive this machine can read, or it was cut short`,
      );
    }
  }

  async function upload(
    sequence: number,
    args: Record<string, unknown>,
    token: string | undefined,
    signal: AbortSignal,
  ): Promise<CallOutcome> {
    if (typeof args.workspacePath !== "string")
      return refused(
        "workspacePath is the file in your own workspace, e.g. work/report.csv",
      );
    const segments = pathSegments(args.path);
    if (segments === null)
      return refused(
        "path must be where the file lands on this machine, relative to the directory it exposes",
      );
    if (token === undefined)
      return failed("this job was claimed without a transfer token");

    const overwrite = args.overwrite === true;
    if (args.unpack === true) {
      if (overwrite)
        return refused(
          "a directory upload never replaces or merges into an existing directory — choose a new path",
        );
      return uploadDirectory(
        sequence,
        String(args.path),
        segments,
        token,
        signal,
      );
    }

    const staged = await stageInRoot(input.root, segments);
    if (!staged.ok)
      return refused(`${String(args.path)} ${REFUSALS[staged.reason]}`);

    const hash = createHash("sha256");
    let bytes = 0;
    try {
      const incoming = await input.transfer.receive({
        sequence,
        token,
        signal,
      });
      for await (const chunk of incoming.stream) {
        const part = chunk as Buffer;
        bytes += part.length;
        if (bytes > cap) throw new Error("too large");
        hash.update(part);
        await writeAll(staged.staged, part);
      }
    } catch (err) {
      await discardStaged(staged.staged);
      if (signal.aborted)
        return { status: "cancelled", output: "", truncated: false };
      return failed(
        err instanceof Error && err.message === "too large"
          ? `the file is over the ${cap} byte transfer limit`
          : "the transfer did not finish",
      );
    }

    const onDisk = await stagedDigest(staged.staged);
    if (
      onDisk === null ||
      onDisk.size !== bytes ||
      onDisk.sha256 !== hash.digest("hex")
    ) {
      await discardStaged(staged.staged);
      return failed("what reached this machine is not what the workspace sent");
    }

    const published = await publishInRoot(input.root, staged.staged, overwrite);
    if (published !== null)
      return refused(`${String(args.path)} ${REFUSALS[published]}`);
    return done({ path: String(args.path), ...onDisk });
  }

  return {
    get tools(): SatelliteTool[] {
      return [
        downloadTool(input.root, cap),
        ...(input.allowUpload ? [uploadTool(input.root, cap)] : []),
        listTool(input.root),
        statTool(input.root),
      ];
    },

    ensureReady: () => Promise.resolve({ restarted: false }),

    async call({ sequence, tool, args, transferToken }): Promise<CallOutcome> {
      const controller = new AbortController();
      running.set(sequence, controller);
      try {
        switch (tool) {
          case DOWNLOAD_TOOL:
            return await download(
              sequence,
              args,
              transferToken,
              controller.signal,
            );
          case UPLOAD_TOOL:
            return input.allowUpload
              ? await upload(sequence, args, transferToken, controller.signal)
              : refused(
                  "this satellite cannot receive files — it was started without --upload",
                );
          case LIST_TOOL:
            return await list(args, controller.signal);
          case STAT_TOOL:
            return await stat(args, controller.signal);
          default:
            return refused(`this satellite has no tool called "${tool}"`);
        }
      } catch (err) {
        if (controller.signal.aborted)
          return { status: "cancelled", output: "", truncated: false };
        const transfer = tool === DOWNLOAD_TOOL || tool === UPLOAD_TOOL;
        return failed(
          err instanceof Error && err.message === "too large"
            ? `the file is over the ${cap} byte transfer limit`
            : transfer
              ? "the transfer failed"
              : "the call failed",
        );
      } finally {
        running.delete(sequence);
      }
    },

    describeCall: (tool, args) => {
      switch (tool) {
        case UPLOAD_TOOL:
          return args.unpack === true
            ? `upload ${String(args.workspacePath)} → ${String(args.path)}/ (unpack)`
            : `upload ${String(args.workspacePath)} → ${String(args.path)}`;
        case LIST_TOOL:
          return `list ${String(args.path ?? ".")}`;
        case STAT_TOOL:
          return `stat ${String(args.path)}`;
        case DOWNLOAD_TOOL:
          return `download ${String(args.path)}${rangeLabel(args)}`;
        default:
          return tool;
      }
    },

    cancel(sequence: number): void {
      running.get(sequence)?.abort();
    },

    killAll(): void {
      for (const controller of running.values()) controller.abort();
    },

    close: () => Promise.resolve(),
  };
}
