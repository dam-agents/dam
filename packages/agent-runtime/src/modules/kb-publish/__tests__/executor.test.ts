import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentHash } from "agent-runtime-api/kb-snapshot";
import { afterAll, beforeAll, expect, it, onTestFinished, vi } from "vitest";

import { executeWork } from "../executor.js";

/**
 * TEST_OVERVIEW: the publish executor's uploads to presigned URLs, against a
 * real local HTTP server — an attempt the store never answers is cut off by
 * its timeout and retried, so the flush ends instead of holding the share's
 * publish claim.
 */

const caps = {
  perFileMaxBytes: 1024,
  totalMaxBytes: 10 * 1024,
  maxFiles: 10,
  maxWalkDepth: 4,
};
const text = "# hello world\n";

let workDir = "";
let server: Server;
let origin = "";
const puts: string[] = [];
const attemptTimeouts: AbortController[] = [];

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "kb-publish-executor-"));
  await mkdir(join(workDir, "wiki"), { recursive: true });
  await writeFile(join(workDir, "wiki/index.md"), text);
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      puts.push(req.url ?? "");
      if (puts.length > 1) res.end();
      else
        attemptTimeouts[0]?.abort(
          new DOMException("signal timed out", "TimeoutError"),
        );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await rm(workDir, { recursive: true, force: true });
});

/**
 * TEST_SCENARIO: the store takes the first blob PUT and never answers it, as
 * a stalled object store does. The attempt times out, the retry lands, and
 * the segment upload follows, so the work order completes. The test fires
 * the attempt's timeout once the store holds the PUT: a wall-clock timeout
 * short enough for a test also cuts off the answered attempts on a busy
 * machine.
 */
it("retries an upload the store never answers", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController();
    attemptTimeouts.push(controller);
    return controller.signal;
  });
  onTestFinished(() => timeout.mockRestore());
  const result = await executeWork({
    workDir,
    log: () => {},
    uploadTimeoutMs: 200,
    work: {
      caps,
      bucketCount: 1,
      blobs: [
        {
          path: "wiki/index.md",
          expectedHash: contentHash(Buffer.from(text)),
          putUrl: `${origin}/blob`,
        },
      ],
      segments: [
        {
          bucket: 0,
          members: [
            {
              path: "wiki/index.md",
              expectedHash: contentHash(Buffer.from(text)),
            },
          ],
          putUrl: `${origin}/seg`,
        },
      ],
    },
  });

  expect(result.ok).toBe(true);
  expect(puts).toEqual(["/blob", "/blob", "/seg"]);
  expect(timeout.mock.calls).toEqual([[200], [200], [200]]);
});
