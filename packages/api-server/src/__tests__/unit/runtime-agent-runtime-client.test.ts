/** TEST_OVERVIEW: the api-server's applyState call into an agent carries a
 *  deadline. An agent that accepts the connection but never answers must fail
 *  the call once the deadline passes, instead of holding a delivery-worker slot
 *  for the transport's default five-minute headers timeout. */
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ApplyStateInput } from "api-server-api";
import { createAgentRuntimeClient } from "../../modules/runtime-delivery/infrastructure/agent-runtime-client.js";

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function serverThatNeverAnswers(): Promise<string> {
  const server = createServer(() => {});
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const input: ApplyStateInput = {
  version: 1,
  state: { contributions: [], hash: "h" },
  events: [],
};

describe("agent-runtime client deadline", () => {
  /** TEST_SCENARIO: the agent reads the request and never replies — the wedged
   *  pod from production. The call rejects on the deadline. */
  it("gives up on an agent that never answers", async () => {
    const base = await serverThatNeverAnswers();
    const client = createAgentRuntimeClient("agent-wedged", "ns", {
      fetch: (_input, init) => fetch(`${base}/api/trpc`, init as RequestInit),
      timeoutMs: 50,
    });

    await expect(client.applyState(input)).rejects.toThrow(/timeout|abort/i);
  });
});
