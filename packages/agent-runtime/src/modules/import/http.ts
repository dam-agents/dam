import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import busboy from "busboy";
import { extractBundle } from "./extract.js";
import { finalize, type FinalizeMode } from "./finalize.js";
import { preflight } from "./preflight.js";

const STAGING_PREFIX = ".import-staging-";

/**
 * Inactivity timeout: if no bytes flow on the upload socket for this
 * long, abort. Bounds stuck connections without capping total bundle
 * size — large-but-progressing uploads stay alive indefinitely.
 */
const UPLOAD_INACTIVITY_MS = 30_000;

export function createImportHandlers(homeDir: string, log: (msg: string) => void) {
  // Single-flight: agent-runtime serves one instance, so concurrent imports
  // mean two simultaneous tarballs racing the same /home/agent — `replace`
  // mode in particular interleaves into a non-deterministic mix. Reject the
  // second one outright with 409. The api-server proxy surfaces the body.
  let activeImport: Promise<void> | null = null;

  async function handleImport(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const ct = req.headers["content-type"];
    if (!ct || !ct.startsWith("multipart/form-data")) {
      res.writeHead(415, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "expected multipart/form-data" }));
      return;
    }
    if (activeImport) {
      res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "another import is already in progress for this instance" }));
      return;
    }

    let resolveActive: () => void = () => {};
    activeImport = new Promise<void>((r) => { resolveActive = r; });

    let mode: FinalizeMode | undefined;
    let prefix = "";
    let staging: string | undefined;
    let extractPromise: Promise<{ filesWritten: number; bytes: number }> | undefined;
    let finished = false;
    const startedAt = Date.now();

    const fail = async (status: number, message: string) => {
      if (finished) return;
      finished = true;
      if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
      if (!res.headersSent) res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    };

    // Per-chunk inactivity timeout. node:http's `setTimeout` fires on the
    // socket if it stays idle for the duration — the right semantics for
    // a long upload that should not stall mid-stream.
    req.setTimeout(UPLOAD_INACTIVITY_MS, () => {
      void fail(408, `upload stalled (no activity for ${UPLOAD_INACTIVITY_MS}ms)`);
      try { req.destroy(); } catch {}
    });

    const bb = busboy({ headers: req.headers });

    bb.on("field", (name: string, value: string) => {
      if (name === "mode") {
        if (value === "replace" || value === "merge") mode = value;
      } else if (name === "prefix") {
        prefix = value;
      }
    });

    bb.on("file", (_name: string, fileStream: NodeJS.ReadableStream) => {
      // mkdtemp is async — start the extract pipeline as soon as we have
      // the staging dir. busboy emits 'file' synchronously when the file
      // part begins; busboy's file stream is paused-mode so bytes don't
      // flow until we attach a consumer.
      extractPromise = (async () => {
        staging = await mkdtemp(join(homeDir, STAGING_PREFIX));
        return extractBundle(fileStream as never, staging);
      })();
    });

    bb.on("error", (err: Error) => { void fail(400, `multipart: ${err.message}`); });

    bb.on("close", async () => {
      try {
        if (!mode) return fail(400, "missing field: mode");
        if (!extractPromise) return fail(400, "missing field: bundle");
        const { filesWritten, bytes } = await extractPromise;
        if (!staging) return fail(500, "internal: staging dir not initialized");
        await finalize(staging, homeDir, prefix, mode);
        await rm(staging, { recursive: true, force: true }).catch(() => {});
        finished = true;
        log(`import ok mode=${mode} prefix=${prefix} files=${filesWritten} bytes=${bytes}`);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
          filesWritten, bytes, durationMs: Date.now() - startedAt,
        }));
      } catch (err) {
        log(`import fail: ${(err as Error).message}`);
        await fail(422, (err as Error).message);
      } finally {
        resolveActive();
        activeImport = null;
      }
    });

    req.pipe(bb);
  }

  async function handleImportPreflight(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: { paths: string[]; prefix?: string };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "bad json" }));
      return;
    }
    if (!Array.isArray(body.paths) || !body.paths.every((p) => typeof p === "string")) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "paths must be string[]" }));
      return;
    }
    try {
      const result = await preflight(body.paths, homeDir, body.prefix ?? "");
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  return { handleImport, handleImportPreflight };
}
