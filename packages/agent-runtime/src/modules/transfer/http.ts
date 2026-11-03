import { randomBytes } from "node:crypto";
import type http from "node:http";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createConfined,
  MAX_TRANSFER_BYTES,
  openConfined,
  publishConfined,
  sweepStaging,
  TRANSFER_STAGING_DIR,
  workspaceSegments,
} from "./confined.js";

const STAGING_MAX_AGE_MS = 10 * 60_000;
const BODY_INACTIVITY_MS = 30_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The workspace end of one satellite file transfer,
 * which the api-server reaches on the Agent's own internal address. A body is
 * staged, then published under a name that was never taken — two requests,
 * because the platform's right to publish is a capability it spends only after
 * the bytes have arrived and the Job is still running.
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
}) {
  const cap = deps.cap ?? MAX_TRANSFER_BYTES;

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

  async function handleStage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > cap) {
      deps.log(`stage refused: declared ${declared} bytes over the cap`);
      req.resume();
      return reply(res, 413, { error: "transfer_too_large" });
    }
    void sweepStaging(deps.root, STAGING_MAX_AGE_MS).catch(() => {});

    const id = randomBytes(16).toString("hex");
    const staged = await createConfined(deps.root, TRANSFER_STAGING_DIR, id);
    if (!staged.ok) {
      deps.log("stage refused: the staging file could not be created");
      req.resume();
      return reply(res, 409, { error: "workspace_refused" });
    }
    const discard = async (): Promise<void> => {
      await staged.handle.close().catch(() => {});
      await rm(join(deps.root, ...TRANSFER_STAGING_DIR, id), {
        force: true,
      }).catch(() => {});
    };

    req.setTimeout(BODY_INACTIVITY_MS, () => req.destroy());

    let received = 0;
    let over = false;
    let failure = false;
    try {
      for await (const chunk of req) {
        const bytes = chunk as Buffer;
        received += bytes.length;
        if (received > cap) {
          over = true;
          req.destroy();
          break;
        }
        await staged.handle.write(bytes);
      }
    } catch {
      failure = true;
    }
    if (!over && !failure) {
      await staged.handle.sync().catch(() => {});
      await staged.handle.close().catch(() => {
        failure = true;
      });
    } else {
      await discard();
    }
    if (over || failure) {
      deps.log(`stage ${id} discarded after ${received} bytes`);
      if (!res.headersSent)
        reply(res, over ? 413 : 409, {
          error: over ? "transfer_too_large" : "transfer_aborted",
        });
      return;
    }
    deps.log(`stage ${id}: ${received} bytes`);
    reply(res, 200, { id, size: received });
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

    const published = await publishConfined(
      deps.root,
      [...TRANSFER_STAGING_DIR, id],
      destination,
      cap,
    );
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
