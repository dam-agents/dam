import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  mountMcpRoutes,
  type MountMcpDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";

vi.mock("../../core/security-log.js", () => ({ securityLog: () => {} }));

// TEST_OVERVIEW: the per-agent MCP endpoint must be stateless, so that any api-server replica can serve any harness call. The waypoint in front of the api-server load-balances every request on its own, so an endpoint holding streamable-HTTP sessions in process answers only the requests that happen to reach the replica holding the session; the harness then comes up without its outbound tools, and a Slack turn runs to the end and posts nothing, because a reply reaches Slack only through the reply tool. Each mounted app here stands for one replica — mountMcpRoutes carries whatever per-process state the endpoint keeps.

const AGENT = "agent-1";
const URL_ = `http://harness/api/agents/${AGENT}/mcp`;

function replica() {
  const app = new Hono();
  mountMcpRoutes(app, {
    channelManager: {
      supportsUserLookup: async () => false,
      supportsMessageReactions: async () => false,
    },
    k8s: {
      namespace: "platform",
      getCustomObject: async () => ({
        metadata: {
          labels: { "agent-platform.ai/owner": "owner-1" },
          uid: "u",
        },
        spec: {},
      }),
    },
    composeSkills: () => ({}),
    schedulesServiceFor: () => ({}),
    artifactLibraryFor: () => ({}),
    invocationsServiceFor: () => ({}),
    experimentsServiceFor: () => ({}),
  } as unknown as MountMcpDeps);
  return app;
}

async function rpc(app: Hono, method: string, params?: unknown) {
  const res = await app.request(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data:"));
  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id"),
    json: JSON.parse(line ? line.slice(5) : body),
  };
}

const INIT = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "probe", version: "1" },
};

describe("per-agent MCP endpoint — stateless across replicas", () => {
  // TEST_SCENARIO: a minted session id is the thing that would bind a harness to the single replica that minted it, so the endpoint must mint none.
  it("mints no session id, so nothing binds a harness to one replica", async () => {
    const { status, sessionId } = await rpc(replica(), "initialize", INIT);

    expect(status).toBe(200);
    expect(sessionId).toBeNull();
  });

  // TEST_SCENARIO: the waypoint routes each request on its own, so an agent's tool call regularly lands on a replica that never saw its initialize; that call must still be served.
  it("serves a call on a replica that never saw the initialize", async () => {
    const [a, b] = [replica(), replica()];
    await rpc(a, "initialize", INIT);

    const { status, json } = await rpc(b, "tools/list");

    expect(status).toBe(200);
    expect(json.result.tools.map((t: { name: string }) => t.name)).toContain(
      "reply",
    );
  });
});
