import { createHash } from "node:crypto";
import { statfs, unlink, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { SATELLITE_FILE_MAX_BYTES, type SatelliteTool } from "api-server-api";
import type { CallOutcome, SatelliteBackend } from "./backend.js";
import {
  openInRoot,
  pathSegments,
  publishInRoot,
  stagedDigest,
  stageInRoot,
  type Refusal,
  type Staged,
} from "./confined-files.js";
import type { FileTransfer } from "./file-transfer.js";

export const DOWNLOAD_TOOL = "download";
export const UPLOAD_TOOL = "upload";

const FREE_SPACE_HEADROOM_BYTES = 1024 ** 3;

async function freeBytesAt(dir: string): Promise<number | null> {
  try {
    const info = await statfs(dir);
    return info.bavail * info.bsize;
  } catch {
    return null;
  }
}

const REFUSALS: Record<Refusal, string> = {
  outside: "is not a place inside the directory this satellite exposes",
  "not-a-file":
    "is not a regular file — it is a link, a directory, or something that is not a file",
  "too-large": `is over the ${SATELLITE_FILE_MAX_BYTES} byte transfer limit`,
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

function done(result: {
  path: string;
  size: number;
  sha256: string;
}): CallOutcome {
  return {
    status: "done",
    isError: false,
    exitCode: null,
    output: JSON.stringify(result),
    truncated: false,
  };
}

function downloadTool(root: string): SatelliteTool {
  return {
    name: DOWNLOAD_TOOL,
    title: "Copy one file from this machine into your workspace",
    transfer: "download",
    description: [
      `Copy one file from ${root} on this machine into your own workspace.`,
      "The contents do not come back in the result: you get the workspace path the file landed at, its size and its sha256, and you open, grep or hash it with your own tools.",
      "path is relative to the directory this machine exposes. A link is refused at any point on the way, even one that points back inside; so is anything that is not a regular file.",
      `Files up to ${SATELLITE_FILE_MAX_BYTES / 1024 ** 3} GiB.`,
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "The file's path on this machine, relative to the exposed directory, e.g. logs/app.log.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  };
}

function uploadTool(root: string): SatelliteTool {
  return {
    name: UPLOAD_TOOL,
    title: "Copy one file from your workspace onto this machine",
    transfer: "upload",
    description: [
      `Copy one file from your workspace to ${root} on this machine.`,
      "path is where it lands, relative to the directory this machine exposes; a missing directory on the way is created, and workspacePath is the file in your own workspace.",
      "An existing file is refused unless overwrite is true.",
      `Files up to ${SATELLITE_FILE_MAX_BYTES / 1024 ** 3} GiB.`,
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Where the file lands on this machine, relative to the exposed directory, e.g. reports/today.csv.",
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
      },
      required: ["path", "workspacePath"],
      additionalProperties: false,
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A directory on the user's machine, offered to an
 * agent as two tools: one file down into the agent's workspace, and with
 * `--upload` one file back up. Read-only unless the user said otherwise, and
 * confined to the root the worker was started with — see `confined-files.ts`
 * for what a path must survive before it is opened.
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
  freeBytes?: (dir: string) => Promise<number | null>;
}): SatelliteBackend {
  const cap = input.maxBytes ?? SATELLITE_FILE_MAX_BYTES;
  const freeBytes = input.freeBytes ?? freeBytesAt;
  const running = new Map<number, AbortController>();

  function chunks(handle: FileHandle, signal: AbortSignal): Readable {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    const source = new Readable({
      async read() {
        if (signal.aborted) {
          this.destroy(new Error("cancelled"));
          return;
        }
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          offset,
        );
        if (bytesRead === 0) {
          this.push(null);
          return;
        }
        offset += bytesRead;
        if (offset > cap) {
          this.destroy(new Error("too large"));
          return;
        }
        this.push(Buffer.from(buffer.subarray(0, bytesRead)));
      },
    });
    source.on("close", () => void handle.close().catch(() => {}));
    return source;
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

    const opened = await openInRoot(input.root, segments, cap);
    if (!opened.ok)
      return refused(`${String(args.path)} ${REFUSALS[opened.reason]}`);

    const written = await input.transfer.send({
      sequence,
      token,
      bytes: chunks(opened.handle, signal),
      declaredBytes: opened.size,
      signal,
    });
    return done(written);
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
      const free = await freeBytes(staged.staged.dir);
      const needed = incoming.size + FREE_SPACE_HEADROOM_BYTES;
      if (free !== null && needed > free) {
        incoming.stream.destroy();
        await discardStaged(staged.staged);
        return failed(
          "the directory this machine exposes does not have room for this file — it needs the file's size plus 1 GiB free",
        );
      }
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
      return input.allowUpload
        ? [downloadTool(input.root), uploadTool(input.root)]
        : [downloadTool(input.root)];
    },

    ensureReady: () => Promise.resolve({ restarted: false }),

    async call({ sequence, tool, args, transferToken }): Promise<CallOutcome> {
      const controller = new AbortController();
      running.set(sequence, controller);
      try {
        if (tool === DOWNLOAD_TOOL)
          return await download(
            sequence,
            args,
            transferToken,
            controller.signal,
          );
        if (tool === UPLOAD_TOOL)
          return input.allowUpload
            ? await upload(sequence, args, transferToken, controller.signal)
            : refused(
                "this satellite cannot receive files — it was started without --upload",
              );
        return refused(`this satellite has no tool called "${tool}"`);
      } catch (err) {
        if (controller.signal.aborted)
          return { status: "cancelled", output: "", truncated: false };
        return failed(
          err instanceof Error && err.message === "too large"
            ? `the file is over the ${cap} byte transfer limit`
            : "the transfer failed",
        );
      } finally {
        running.delete(sequence);
      }
    },

    describeCall: (tool, args) =>
      tool === UPLOAD_TOOL
        ? `upload ${String(args.workspacePath)} → ${String(args.path)}`
        : tool === DOWNLOAD_TOOL
          ? `download ${String(args.path)}`
          : tool,

    cancel(sequence: number): void {
      running.get(sequence)?.abort();
    },

    killAll(): void {
      for (const controller of running.values()) controller.abort();
    },

    close: () => Promise.resolve(),
  };
}
