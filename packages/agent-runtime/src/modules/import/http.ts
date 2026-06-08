import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import type { ImportBundleResult } from "agent-runtime-api";
import busboy from "busboy";

import { IMPORT_STAGING_PREFIX } from "../../core/import-staging.js";
import type { ImportDomainError } from "./errors.js";
import { extractBundle } from "./extract.js";
import { finalize } from "./finalize.js";

/**
 * Inactivity timeout: if no bytes flow on the upload socket for this
 * long, abort. Bounds stuck connections without capping total bundle
 * size — large-but-progressing uploads stay alive indefinitely.
 */
const UPLOAD_INACTIVITY_MS = 30_000;

/**
 * Wall-clock ceiling regardless of socket activity. Belt-and-suspenders
 * for the inactivity timeout: under TCP keepalive or trickle sends the
 * socket-level idle timeout may never fire even though the upload is
 * making no real progress. After this many ms the import is forcibly
 * failed.
 */
const UPLOAD_DEADLINE_MS = 30 * 60_000;

function statusForDomainError(error: ImportDomainError): number {
  switch (error.kind) {
    case "InvalidEntry":
    case "TarParseError":
      return 422;
  }
}

function messageForDomainError(error: ImportDomainError): string {
  switch (error.kind) {
    case "InvalidEntry":
      return `refusing entry (${error.reason}): ${error.path}`;
    case "TarParseError":
      return `tar parse error: ${error.detail}`;
  }
}

export function createImportHandlers(
  homeDir: string,
  workDir: string,
  log: (msg: string) => void,
) {
  // Single-flight: agent-runtime serves one agent, so concurrent imports
  // mean two simultaneous tarballs racing the same work dir. Reject the
  // second one outright with 409; the api-server proxy surfaces the body.
  let activeImport: Promise<void> | null = null;

  async function handleImport(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const ct = req.headers["content-type"];
    if (!ct || !ct.startsWith("multipart/form-data")) {
      res
        .writeHead(415, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "expected multipart/form-data" }));
      return;
    }
    if (activeImport) {
      log(`request rejected (409): another import is already in progress`);
      res.writeHead(409, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error: "another import is already in progress for this agent",
        }),
      );
      return;
    }

    const startedAt = Date.now();
    log(
      `request received (content-length=${req.headers["content-length"] ?? "?"})`,
    );

    let resolveActive: () => void = () => {};
    activeImport = new Promise<void>((r) => {
      resolveActive = r;
    });
    // The `close` handler's `finally` is the primary path that resets
    // activeImport. Timeout/deadline paths destroy the socket, which may
    // or may not emit `close` on busboy depending on Node's autoDestroy
    // behavior — `clearActive()` is invoked from every exit path so a
    // stuck activeImport can't survive.
    let activeImportCleared = false;
    const clearActive = () => {
      if (activeImportCleared) return;
      activeImportCleared = true;
      resolveActive();
      activeImport = null;
    };

    let staging: string | undefined;
    let extractPromise:
      | Promise<Awaited<ReturnType<typeof extractBundle>>>
      | undefined;
    let sawFile = false;
    let finished = false;

    const fail = async (status: number, message: string) => {
      if (finished) return;
      finished = true;
      log(`fail ${status}: ${message}`);
      // Let extraction settle before rm — abort paths destroy the socket, so
      // awaiting here means the tar writer stopped and can't race the cleanup.
      if (extractPromise) await extractPromise.catch(() => {});
      if (staging)
        await rm(staging, { recursive: true, force: true }).catch(() => {});
      try {
        if (!res.headersSent)
          res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      } catch (e) {
        log(`fail: response write threw (${(e as Error).message})`);
      }
    };

    // Two safeguards on stuck uploads:
    //  - `req.setTimeout` fires on socket idle (no bytes for N ms).
    //  - A wall-clock deadline fires regardless of socket activity, in
    //    case TCP keepalive or trickle bytes keep the socket "active"
    //    while the upload makes no real progress.
    req.setTimeout(UPLOAD_INACTIVITY_MS, () => {
      log(`socket idle for ${UPLOAD_INACTIVITY_MS}ms — aborting`);
      void fail(
        408,
        `upload stalled (no activity for ${UPLOAD_INACTIVITY_MS}ms)`,
      );
      try {
        req.destroy();
      } catch {}
      clearActive();
    });
    const deadlineTimer = setTimeout(() => {
      log(`wall-clock deadline ${UPLOAD_DEADLINE_MS}ms exceeded — aborting`);
      void fail(408, `upload exceeded ${UPLOAD_DEADLINE_MS}ms deadline`);
      try {
        req.destroy();
      } catch {}
      clearActive();
    }, UPLOAD_DEADLINE_MS);
    deadlineTimer.unref();

    const bb = busboy({ headers: req.headers });

    bb.on("file", (_name: string, fileStream: NodeJS.ReadableStream) => {
      if (sawFile) {
        // Multiple file parts would race a second `mkdtemp` and clobber
        // `staging`, leaking the first dir. Refuse outright; drain the
        // stream so busboy proceeds to `close`.
        fileStream.resume();
        void fail(400, "multiple file parts");
        return;
      }
      sawFile = true;
      log(`file part received — extracting`);
      extractPromise = (async () => {
        staging = await mkdtemp(join(homeDir, IMPORT_STAGING_PREFIX));
        log(`staging dir created: ${staging}`);
        const result = await extractBundle(fileStream as never, staging);
        log(`extract complete (ok=${result.ok})`);
        return result;
      })();
    });

    bb.on("error", (err: Error) => {
      void fail(400, `multipart: ${err.message}`);
    });

    bb.on("close", async () => {
      log(`busboy close — finalizing`);
      clearTimeout(deadlineTimer);
      try {
        if (finished) return;
        if (!extractPromise) return fail(400, "missing field: bundle");
        const extractResult = await extractPromise;
        if (!extractResult.ok) {
          return fail(
            statusForDomainError(extractResult.error),
            messageForDomainError(extractResult.error),
          );
        }
        if (!staging) return fail(500, "internal: staging dir not initialized");
        log(`finalize start (dest=${workDir})`);
        await finalize(staging, workDir);
        await rm(staging, { recursive: true, force: true }).catch(() => {});
        // A timeout/deadline firing between extract-complete and here
        // would have flipped `finished` and already sent a 408 — in that
        // case the disk is in the right state (finalize ran) but the
        // wire response is taken; don't double-write.
        if (finished) {
          log(
            `finalize committed but response already sent (likely timeout race) — skipping 200 write`,
          );
          return;
        }
        finished = true;
        const { filesWritten, bytes } = extractResult.value;
        log(
          `import ok files=${filesWritten} bytes=${bytes} durationMs=${Date.now() - startedAt}`,
        );
        try {
          const body: ImportBundleResult = {
            filesWritten,
            bytes,
            durationMs: Date.now() - startedAt,
          };
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify(body));
        } catch (e) {
          log(
            `response write threw on success (${(e as Error).message}) — finalize already committed`,
          );
        }
      } catch (err) {
        log(`bb.close handler caught: ${(err as Error).message}`);
        await fail(500, (err as Error).message);
      } finally {
        clearActive();
      }
    });

    req.pipe(bb);
  }

  return { handleImport };
}
