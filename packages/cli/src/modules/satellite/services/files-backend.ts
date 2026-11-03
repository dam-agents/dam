import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { SATELLITE_FILE_MAX_BYTES, type SatelliteTool } from "api-server-api";
import type { CallOutcome, SatelliteBackend } from "./backend.js";
import type { FileTransfer } from "./file-transfer.js";

export const DOWNLOAD_TOOL = "download";
export const UPLOAD_TOOL = "upload";
const MAX_PATH_CHARS = 1024;

export type ResolvedRoot =
  { ok: true; root: string } | { ok: false; reason: string };

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one directory a `dam satellite files` worker
 * exposes, resolved once at startup. A root is refused when it is the whole
 * filesystem or an ancestor of the home directory, because the boundary is the
 * root itself: a deny-list of credential paths inside the home would be false
 * comfort, and whoever wants the agent to see a directory can name it.
 */
export async function resolveFileRoot(raw: string): Promise<ResolvedRoot> {
  const root = await realpath(resolve(raw)).catch(() => null);
  if (root === null) return { ok: false, reason: `there is no ${raw}` };
  const info = await stat(root).catch(() => null);
  if (info === null || !info.isDirectory())
    return { ok: false, reason: `${raw} is not a directory` };
  if (root === sep)
    return { ok: false, reason: "name a directory, not the whole filesystem" };
  const home = await realpath(homedir()).catch(() => homedir());
  if (home === root)
    return {
      ok: false,
      reason:
        "name the directory the agent may read, not your home directory — it is all of it",
    };
  if (home.startsWith(root + sep))
    return {
      ok: false,
      reason: `name the directory the agent may read, not ${root} — your home directory is inside it`,
    };
  return { ok: true, root };
}

function wellFormed(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path !== "" &&
    path.length <= MAX_PATH_CHARS &&
    !path.includes("\0") &&
    !isAbsolute(path) &&
    !path.split("/").includes("..")
  );
}

async function fileInRoot(root: string, path: unknown): Promise<string | null> {
  if (!wellFormed(path)) return null;
  const real = await realpath(join(root, path)).catch(() => null);
  if (real === null || !real.startsWith(root + sep)) return null;
  return real;
}

async function writableInRoot(
  root: string,
  path: unknown,
): Promise<string | null> {
  if (!wellFormed(path)) return null;
  const segments = path.split("/").filter((part) => part !== "");
  const name = segments.at(-1);
  if (name === undefined || name === ".") return null;

  let dir = root;
  for (const segment of segments.slice(0, -1)) {
    const next = join(dir, segment);
    const info = await lstat(next).catch(() => null);
    if (info === null) {
      if ((await mkdir(next).catch(() => null)) === null) return null;
    } else if (!info.isDirectory() || info.isSymbolicLink()) {
      return null;
    }
    dir = next;
  }
  const target = join(dir, name);
  if ((await lstat(target).catch(() => null))?.isSymbolicLink() === true)
    return null;
  return target;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    description: [
      `Copy one file from ${root} on this machine into your own workspace.`,
      "The contents do not come back in the result: you get the workspace path the file landed at, its size and its sha256, and you open, grep or hash it with your own tools.",
      "path is relative to the directory this machine exposes; a symlink that leads out of it is refused, and so is anything that is not a regular file.",
      `Files up to ${Math.round(SATELLITE_FILE_MAX_BYTES / (1024 * 1024))} MB.`,
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
    description: [
      `Copy one file from your workspace to ${root} on this machine.`,
      "path is where it lands, relative to the directory this machine exposes; a missing directory on the way is created, and workspacePath is the file in your own workspace.",
      "An existing file is refused unless overwrite is true.",
      `Files up to ${Math.round(SATELLITE_FILE_MAX_BYTES / (1024 * 1024))} MB.`,
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
 * confined to the root the worker was started with — `realpath` on both the
 * file read and the directory written, so a symlink that leads out is refused
 * along with `..` and an absolute path.
 *
 * The ceiling to know: `realpath` and the read or write are separate calls, so
 * a process inside the root could swap a link between them (TOCTOU). The
 * upgrade path is `openat2(RESOLVE_BENEATH)`, which Node does not expose.
 */
export function createFilesBackend(input: {
  root: string;
  allowUpload: boolean;
  transfer: FileTransfer;
  maxBytes?: number;
}): SatelliteBackend {
  const cap = input.maxBytes ?? SATELLITE_FILE_MAX_BYTES;
  const running = new Map<number, AbortController>();

  async function download(
    sequence: number,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallOutcome> {
    if (typeof args.path !== "string")
      return refused(
        "path is the file's path on this machine, relative to the directory it exposes",
      );
    const file = await fileInRoot(input.root, args.path);
    if (file === null)
      return refused(
        `${String(args.path)} is not a file inside ${input.root} — give a path relative to it, with no .. and no symlink that leads out`,
      );
    const info = await stat(file).catch(() => null);
    if (info === null || !info.isFile())
      return refused(`${String(args.path)} is not a regular file`);
    if (info.size > cap)
      return refused(
        `${String(args.path)} is ${info.size} bytes; one transfer carries at most ${cap}`,
      );
    const bytes = await readFile(file);
    return done(
      await input.transfer.send({
        sequence,
        name: basename(file),
        bytes,
        signal,
      }),
    );
  }

  async function upload(
    sequence: number,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallOutcome> {
    if (typeof args.workspacePath !== "string")
      return refused(
        "workspacePath is the file in your own workspace, e.g. work/report.csv",
      );
    const target = await writableInRoot(input.root, args.path);
    if (target === null)
      return refused(
        `${String(args.path)} is not a place inside ${input.root} this satellite may write to — give a path relative to it, with no .. and no symlink`,
      );
    const overwrite = args.overwrite === true;
    if (!overwrite && (await lstat(target).catch(() => null)) !== null)
      return refused(
        `${String(args.path)} already exists on this machine — pass overwrite: true to replace it`,
      );
    const bytes = await input.transfer.receive({
      sequence,
      path: args.workspacePath,
      signal,
    });
    if (bytes.length > cap)
      return refused(
        `${String(args.workspacePath)} is ${bytes.length} bytes; one transfer carries at most ${cap}`,
      );
    await writeFile(target, bytes, { flag: overwrite ? "w" : "wx" });
    return done({
      path: String(args.path),
      size: bytes.length,
      sha256: sha256(bytes),
    });
  }

  return {
    get tools(): SatelliteTool[] {
      return input.allowUpload
        ? [downloadTool(input.root), uploadTool(input.root)]
        : [downloadTool(input.root)];
    },

    async call({ sequence, tool, args }): Promise<CallOutcome> {
      const controller = new AbortController();
      running.set(sequence, controller);
      try {
        if (tool === DOWNLOAD_TOOL)
          return await download(sequence, args, controller.signal);
        if (tool === UPLOAD_TOOL)
          return input.allowUpload
            ? await upload(sequence, args, controller.signal)
            : refused(
                "this satellite cannot receive files — it was started without --upload",
              );
        return refused(`this satellite has no tool called "${tool}"`);
      } catch (err) {
        if (controller.signal.aborted)
          return { status: "cancelled", output: "", truncated: false };
        return {
          status: "done",
          isError: true,
          exitCode: null,
          output: `the transfer failed: ${reasonOf(err)}`,
          truncated: false,
        };
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
