import { createHash } from "node:crypto";
import { statfs } from "node:fs/promises";
import type http from "node:http";
import { SATELLITE_FILE_MAX_BYTES } from "api-server-api";
import {
  createStaged,
  discardStaged,
  openConfined,
  openStaged,
  publishStaged,
  stagedDigest,
  sweepStaging,
  workspaceSegments,
  type Staged,
} from "./confined.js";

const STAGING_MAX_AGE_MS = 10 * 60_000;
const SWEEP_EVERY_MS = 60_000;
/**
 * UNIT_BOUNDARY_DESCRIPTION: How long a body may stall while bytes are still
 * arriving. The timer runs on the socket, which outlives the last byte, so the
 * stage disarms it before it reads the staged file back: that read-back sends
 * nothing, and a timer left armed would destroy a connection that is working.
 */
const BODY_INACTIVITY_MS = 30_000;
const FREE_SPACE_HEADROOM_BYTES = 1024 ** 3;

async function freeBytesAt(dir: string): Promise<number | null> {
  try {
    const info = await statfs(dir);
    return info.bavail * info.bsize;
  } catch {
    return null;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The workspace end of one satellite file transfer,
 * which the api-server reaches on the Agent's own internal address. A body is
 * staged under a random name in the directory it will land in, the bytes on disk
 * are read back and compared with what was hashed, and only then is the file
 * published — by one step taken inside that directory's inode, under a name
 * that was never taken. Splitting stage from publish is what lets the platform
 * spend the Job's claim only once the whole file has arrived.
 *
 * Nothing here trusts a path the caller sends: every path is re-validated
 * against the workspace, walked component by component and opened without
 * following a link. What is logged is the path and the byte count, never a byte
 * of the file and never an error's raw text.
 */
export function createTransferHandlers(deps: {
  root: string;
  log: (msg: string) => void;
  reserved: readonly string[];
  cap?: number;
  freeBytes?: (dir: string) => Promise<number | null>;
  bodyInactivityMs?: number;
  verify?: typeof stagedDigest;
}) {
  const cap = deps.cap ?? SATELLITE_FILE_MAX_BYTES;
  const freeBytes = deps.freeBytes ?? freeBytesAt;
  const bodyInactivityMs = deps.bodyInactivityMs ?? BODY_INACTIVITY_MS;
  const verify = deps.verify ?? stagedDigest;
  let lastSweep = 0;

  const segmentsOf = (relative: unknown): string[] | null =>
    typeof relative === "string"
      ? workspaceSegments(relative, deps.reserved)
      : null;

  function reply(
    res: http.ServerResponse,
    status: number,
    body: Record<string, unknown>,
  ): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: Writes one chunk in full. A regular-file write
   * may write less than it was given, and a stage that treated a short result as
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

  async function handleStage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const destination = segmentsOf(req.headers["x-dam-path"]);
    if (destination === null) {
      req.resume();
      return reply(res, 400, { error: "bad_path" });
    }
    const declared = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > cap) {
      deps.log("stage refused: the declared body is over the cap");
      req.resume();
      return reply(res, 413, { error: "transfer_too_large" });
    }
    if (Date.now() - lastSweep > SWEEP_EVERY_MS) {
      lastSweep = Date.now();
      void sweepStaging(deps.root, STAGING_MAX_AGE_MS).catch(() => {});
    }

    const created = await createStaged(deps.root, destination);
    if (!created.ok) {
      deps.log(`stage refused: ${created.reason}`);
      req.resume();
      return reply(res, created.reason === "exists" ? 409 : 400, {
        error:
          created.reason === "exists" ? "already_there" : "workspace_refused",
      });
    }
    const staged = created.staged;

    if (declared > 0) {
      const free = await freeBytes(staged.dir);
      const needed = declared + FREE_SPACE_HEADROOM_BYTES;
      if (free !== null && needed > free) {
        deps.log(`stage refused: ${needed} bytes needed, ${free} free`);
        await discardStaged(staged);
        req.resume();
        return reply(res, 507, { error: "no_space", free, needed });
      }
    }

    req.setTimeout(bodyInactivityMs, () => req.destroy());

    const hash = createHash("sha256");
    let received = 0;
    let failure: "too-large" | "aborted" | null = null;
    try {
      for await (const chunk of req) {
        const bytes = chunk as Buffer;
        received += bytes.length;
        if (received > cap) {
          failure = "too-large";
          req.destroy();
          break;
        }
        hash.update(bytes);
        await writeAll(staged, bytes);
      }
    } catch {
      failure = "aborted";
    }
    req.socket?.setTimeout(0);

    if (failure === null) {
      const onDisk = await verify(staged);
      if (
        onDisk === null ||
        onDisk.size !== received ||
        onDisk.sha256 !== hash.digest("hex")
      ) {
        failure = "aborted";
        deps.log(
          `stage ${staged.id}: what reached the disk is not what arrived`,
        );
      }
    }

    await staged.handle.close().catch(() => {});
    if (failure !== null) {
      deps.log(`stage ${staged.id} discarded after ${received} bytes`);
      await discardStaged(staged);
      if (!res.headersSent)
        reply(res, failure === "too-large" ? 413 : 409, {
          error:
            failure === "too-large" ? "transfer_too_large" : "transfer_aborted",
        });
      return;
    }
    deps.log(`stage ${staged.id}: ${received} bytes`);
    reply(res, 200, { id: staged.id, size: received });
  }

  async function handlePublish(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await readJson(req).catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const destination = segmentsOf(body?.path);
    if (!/^[0-9a-f]{32}$/.test(id) || destination === null)
      return reply(res, 400, { error: "bad_publish" });

    const staged = await openStaged(deps.root, destination, id);
    if (staged === null) return reply(res, 409, { error: "workspace_refused" });

    const published = await publishStaged(deps.root, staged);
    if (!published.ok) {
      deps.log(`publish ${id} refused: ${published.reason}`);
      return reply(res, published.reason === "exists" ? 409 : 400, {
        error:
          published.reason === "exists" ? "already_there" : "workspace_refused",
      });
    }
    deps.log(`publish ${id}: ${destination.join("/")}`);
    reply(res, 200, { path: published.path });
  }

  async function handleRead(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    const segments = segmentsOf(url.searchParams.get("path"));
    if (segments === null) return reply(res, 400, { error: "bad_path" });

    const opened = await openConfined(deps.root, segments, cap);
    if (!opened.ok) {
      deps.log(`read ${segments.join("/")} refused: ${opened.reason}`);
      return reply(
        res,
        opened.reason === "not-found"
          ? 404
          : opened.reason === "too-large"
            ? 413
            : 409,
        {
          error:
            opened.reason === "not-found"
              ? "not_found"
              : opened.reason === "too-large"
                ? "transfer_too_large"
                : "workspace_refused",
        },
      );
    }

    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(opened.size),
    });
    const buffer = Buffer.allocUnsafe(Math.min(opened.size, 64 * 1024) || 1);
    let sent = 0;
    try {
      while (sent < opened.size) {
        const { bytesRead } = await opened.handle.read(
          buffer,
          0,
          Math.min(buffer.length, opened.size - sent),
          sent,
        );
        if (bytesRead === 0) break;
        sent += bytesRead;
        if (sent > cap) {
          deps.log(`read ${segments.join("/")}: over the cap — cut short`);
          res.destroy();
          break;
        }
        if (!res.write(buffer.subarray(0, bytesRead))) await drained(res);
      }
      if (!res.writableEnded) res.end();
    } catch {
      res.destroy();
    } finally {
      await opened.handle.close().catch(() => {});
    }
  }

  return { handleStage, handlePublish, handleRead };
}

function drained(res: http.ServerResponse): Promise<void> {
  return new Promise((settle) => {
    res.once("drain", settle);
    res.once("close", settle);
  });
}

async function readJson(
  req: http.IncomingMessage,
): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > 8 * 1024) return null;
    chunks.push(bytes);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
