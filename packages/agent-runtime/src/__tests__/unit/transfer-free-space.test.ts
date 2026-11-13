import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SATELLITE_FILE_MAX_BYTES } from "api-server-api";
import {
  stagedDigest,
  STAGING_PREFIX,
} from "../../modules/transfer/confined.js";
import { createTransferHandlers } from "../../modules/transfer/http.js";

/**
 * TEST_OVERVIEW: The workspace end of a satellite transfer on a disk that is too
 * full for the file. Before it stages a byte the runtime asks the filesystem for
 * the free space and refuses a body whose declared size plus 1 GiB of headroom
 * does not fit, with HTTP 507 `no_space` — the reason travels back to the agent
 * instead of a generic workspace refusal. The default ceiling is the one
 * constant api-server-api declares, and a body that declares no size skips the
 * pre-check because the byte counter still enforces the cap.
 */

const GIB = 1024 ** 3;
const DESTINATION = ".dam/satellite-files/laptop-1-aaaaaaaa/note.txt";
const LANDED = join(".dam", "satellite-files", "laptop-1-aaaaaaaa");

let dir: string;
let server: Server;
let handlers: ReturnType<typeof createTransferHandlers>;

function stageHandlers(freeBytes?: (dir: string) => Promise<number | null>) {
  return createTransferHandlers({
    root: dir,
    reserved: [],
    log: () => {},
    ...(freeBytes === undefined ? {} : { freeBytes }),
  });
}

beforeAll(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "dam-transfer-space-")));
  server = createServer((req, res) => void handlers.handleStage(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

function stage(options: {
  declared?: number;
  body?: Buffer;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((settle, fail) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: (server.address() as AddressInfo).port,
        path: "/api/transfer/stage",
        method: "POST",
        headers: {
          "x-dam-path": DESTINATION,
          "content-type": "application/octet-stream",
          ...(options.declared === undefined
            ? { "transfer-encoding": "chunked" }
            : { "content-length": String(options.declared) }),
        },
      },
      async (res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of res) chunks.push(chunk as Buffer);
        const text = Buffer.concat(chunks).toString();
        settle({
          status: res.statusCode ?? 0,
          json:
            text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
        });
      },
    );
    req.on("error", fail);
    req.end(options.body);
  });
}

describe("the free space a stage needs on the agent", () => {
  /**
   * TEST_SCENARIO: A five byte body lands on a filesystem with just enough room
   * for the headroom and not for the file, so the file plus its 1 GiB of headroom
   * does not fit. The stage must be refused before a byte is written, with the
   * space it needs and the space it has, because the agent can then free a
   * directory and try again. The filesystem measured is the one the file lands
   * on, which a mount under the workspace root makes a different one.
   */
  it("refuses a body it cannot hold, and leaves no stage", async () => {
    const measured: string[] = [];
    handlers = stageHandlers(async (at) => {
      measured.push(at);
      return GIB + 4;
    });

    const answer = await stage({ declared: 5, body: Buffer.from("hello") });

    expect(answer.status).toBe(507);
    expect(answer.json).toEqual({
      error: "no_space",
      free: GIB + 4,
      needed: GIB + 5,
    });
    expect(measured).toEqual([join(dir, LANDED)]);
    expect(await readdir(join(dir, LANDED))).toEqual([]);
  });

  it("stages the same body when the headroom fits", async () => {
    handlers = stageHandlers();

    const answer = await stage({ declared: 5, body: Buffer.from("hello") });

    expect(answer.status).toBe(200);
    expect(typeof answer.json.id).toBe("string");
    const staged = await readdir(join(dir, LANDED));
    expect(staged).toHaveLength(1);
    expect(staged[0]?.startsWith(STAGING_PREFIX)).toBe(true);
  });

  /**
   * TEST_SCENARIO: Verifying a large file reads it back in silence after the
   * last byte arrived, and the body's inactivity timer runs on the socket, which
   * outlives that byte. A timer still armed kills a connection that is working,
   * so the answer must arrive after a verification longer than the timer.
   */
  it("answers after a verification that outlasts the body's idle timer", async () => {
    handlers = createTransferHandlers({
      root: dir,
      reserved: [],
      log: () => {},
      bodyInactivityMs: 20,
      verify: async (staged) => {
        await new Promise((settle) => setTimeout(settle, 250));
        return stagedDigest(staged);
      },
    });

    const answer = await stage({ declared: 5, body: Buffer.from("hello") });

    expect(answer.status).toBe(200);
    expect(typeof answer.json.id).toBe("string");
  });

  /**
   * TEST_SCENARIO: A body that declares no length arrives chunked. There is
   * nothing to compare against the free space yet, so the pre-check is skipped
   * and the byte counter is what enforces the cap.
   */
  it("skips the pre-check when the body declares no length", async () => {
    handlers = stageHandlers(async () => 1);

    const answer = await stage({ body: Buffer.from("hello") });

    expect(answer.status).toBe(200);
  });
});

describe("the ceiling a stage enforces", () => {
  /**
   * TEST_SCENARIO: The runtime's default cap is the one constant
   * api-server-api declares, so a platform and an agent built from the same
   * source never disagree about what a transfer may carry.
   */
  it("is the one constant, and still cuts a body over it", async () => {
    expect(SATELLITE_FILE_MAX_BYTES).toBe(5 * GIB);
    handlers = stageHandlers(async () => 100 * GIB);

    const answer = await stage({ declared: SATELLITE_FILE_MAX_BYTES + 1 });

    expect(answer.status).toBe(413);
    expect(answer.json).toEqual({ error: "transfer_too_large" });
  });
});
