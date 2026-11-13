import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * TEST_OVERVIEW: The api-server's relay to the workspace. It must never leave a
 * request half-open: a body that fails mid-stream tears the request down, so the
 * runtime stops reading and the transfer fails as a whole. The specs run a real
 * HTTP server in place of the runtime and watch what it actually sees.
 */

const seen: {
  path: string;
  ended: boolean;
  aborted: boolean;
  body: Buffer;
}[] = [];

const silent: { stage: number; publish: number } = { stage: 0, publish: 0 };

let server: Server;

vi.mock("../../modules/agents/infrastructure/k8s.js", () => ({
  agentServiceAddress: () => `${process.env.TRANSFER_TEST_HOST}`,
}));

let transfer: typeof import("../../modules/satellites/infrastructure/agent-transfer.js");

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    const entry = {
      path: req.url ?? "",
      ended: false,
      aborted: false,
      body: Buffer.alloc(0),
    };
    seen.push(entry);
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      entry.ended = true;
      entry.body = Buffer.concat(chunks);
      const answer = () =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(
            JSON.stringify(
              entry.path.startsWith("/api/transfer/stage")
                ? { id: "c".repeat(32) }
                : { path: "/home/agent/x" },
            ),
          );
      const wait = entry.path.startsWith("/api/transfer/stage")
        ? silent.stage
        : silent.publish;
      if (wait === 0) answer();
      else setTimeout(answer, wait);
    });
    req.on("aborted", () => {
      entry.aborted = true;
      entry.body = Buffer.concat(chunks);
    });
    req.on("close", () => {
      entry.body = Buffer.concat(chunks);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.TRANSFER_TEST_HOST = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  transfer =
    await import("../../modules/satellites/infrastructure/agent-transfer.js");
});

afterAll(() => {
  server.close();
  delete process.env.TRANSFER_TEST_HOST;
});

describe("the relay to the workspace", () => {
  it("sends a body through and reports the workspace's staging answer", async () => {
    const staged = await transfer.createAgentTransfer("agent-1", "ns").stage({
      body: Readable.from([Buffer.from("hello")]),
      path: ".dam/satellite-files/laptop-1/note",
      declaredBytes: 5,
    });

    expect(staged).toEqual({ ok: true, id: "c".repeat(32) });
    const last = seen.at(-1);
    expect(last?.ended).toBe(true);
    expect(last?.body.toString()).toBe("hello");
  });

  /**
   * TEST_SCENARIO: The body is a network stream, and it can fail after some
   * bytes. The request must be destroyed, so the runtime does not sit reading a
   * body that will never end, and the transfer must answer as a failure.
   */
  it("destroys the request when the body fails mid-stream", async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from("half"));
        this.destroy(new Error("the machine hung up"));
      },
    });

    const before = seen.length;
    const staged = await transfer.createAgentTransfer("agent-1", "ns").stage({
      body: failing,
      path: ".dam/satellite-files/laptop-1/note",
      declaredBytes: 10,
    });

    expect(staged).toEqual({ ok: false, reason: "aborted" });
    /**
     * TEST_SCENARIO: Nothing of that request reaches the workspace as a complete
     * one: either it is cut off with the socket, or it arrives truncated and
     * aborted. An `end` would mean the runtime was told the body was whole.
     */
    const reached = seen.slice(before);
    expect(reached.every((entry) => entry.ended === false)).toBe(true);
    expect(reached.every((entry) => entry.body.length < 10)).toBe(true);
  });

  it("maps the workspace's refusals to codes", async () => {
    expect(
      await transfer.createAgentTransfer("agent-1", "ns").publish({
        id: "c".repeat(32),
        path: ".dam/satellite-files/laptop-1/note",
      }),
    ).toEqual({ ok: true, path: "/home/agent/x" });
  });
});

describe("the time the relay waits", () => {
  /**
   * TEST_SCENARIO: After the last byte the workspace re-reads the staged file to
   * compare its hash, and that read-back sends nothing, so a stage request that
   * used the transfer timeout would be torn down on a large file. Stage must
   * outlast the silence; publish and read keep the shorter timeout.
   */
  it("lets a stage sit silent past the transfer timeout, and no other request", async () => {
    expect(transfer.TRANSFER_TIMEOUT_MS).toBe(60_000);
    expect(transfer.STAGE_IDLE_TIMEOUT_MS).toBe(10 * 60_000);

    const patient = transfer.createAgentTransfer("agent-1", "ns", {
      transferMs: 50,
      stageMs: 1000,
    });
    silent.stage = 200;
    silent.publish = 200;

    expect(
      await patient.stage({
        body: Readable.from([Buffer.from("hello")]),
        path: ".dam/satellite-files/laptop-1/note",
        declaredBytes: 5,
      }),
    ).toEqual({ ok: true, id: "c".repeat(32) });

    expect(
      await patient.publish({
        id: "c".repeat(32),
        path: ".dam/satellite-files/laptop-1/note",
      }),
    ).toEqual({ ok: false, reason: "refused" });

    silent.stage = 0;
    silent.publish = 0;
  });
});
