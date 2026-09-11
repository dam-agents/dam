// TEST_OVERVIEW: a node fetches an agent's workspace from the node that holds it, and the sweep reconciles agents one after another — so a peer that is gone in the way a stopped machine is gone, accepting nothing and refusing nothing, must fail the dial rather than sit in it. Without a deadline the wait is the kernel's retry budget, and every other agent on the node waits with it.
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { openPeerStream } from "../../modules/nodes/infrastructure/peer-link.js";

let server: Server | undefined;
afterEach(() => server?.close());

const credentials = { ca: "", cert: "", key: "" };

describe("dialling a peer that never answers", () => {
  // TEST_SCENARIO: the listener accepts at the TCP level and then does nothing — no TLS, no bytes, the shape a machine presents while it is going away. A dial with no deadline of its own never returns here.
  it("gives up on its own deadline", async () => {
    server = createServer(() => {});
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server!.address() as { port: number }).port;

    const started = Date.now();
    await expect(
      openPeerStream({
        peerAddress: `127.0.0.1:${port}`,
        credentials,
        verb: "export",
        agentId: "agent-1",
        timeoutMs: 300,
      }),
    ).rejects.toThrow(/did not answer in time/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  // TEST_SCENARIO: nothing is listening at all, which the kernel answers immediately — the dial must surface that rather than wait out its deadline.
  it("surfaces a refusal without waiting", async () => {
    const started = Date.now();
    await expect(
      openPeerStream({
        peerAddress: "127.0.0.1:1",
        credentials,
        verb: "dial",
        agentId: "agent-1",
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
