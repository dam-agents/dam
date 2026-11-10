import { Hono } from "hono";
import { expect, it } from "vitest";

import { mountInvocationRoutes } from "../../apps/harness-api-server/invocation-endpoints.js";

// TEST_OVERVIEW: a driver script that replaces its open child's rules over the SDK's REST route learns what the update_subagent_egress tool tells a driver: the rules that wait for the owner, and those the owner blocked on the child.

// TEST_SCENARIO: one rule waits for the owner and one is blocked; the route answers both, so the SDK can hand them to the driver.
it("answers the rules that wait and those the owner blocked", async () => {
  const app = new Hono();
  mountInvocationRoutes(app, {
    agents: { get: async () => null },
    scriptOutputs: {} as never,
    spawningSession: async () => null,
    readAgent: async (id: string) =>
      id === "driver-1"
        ? {
            metadata: {
              uid: "uid-1",
              labels: { "agent-platform.ai/owner": "owner-1" },
            },
            spec: {},
          }
        : null,
    invocationsServiceFor: () => ({}) as never,
    connectionsServiceFor: () => ({}) as never,
    templates: {} as never,
    harnesses: { default: "pi", harnesses: [], telemetryEnv: () => [] },
    budgetsFor: () => ({}) as never,
    inheritanceOf: async () => ({
      parentAgentId: "driver-1",
      egressFrom: "open",
    }),
    childEgress: {
      setOpenRules: async () => ({
        waiting: [{ host: "pypi.org", id: "req-1" }],
        blocked: [{ host: "evil.example" }],
      }),
    },
  });

  const res = await app.request(
    "/api/agents/driver-1/invocations/sub-1/egress",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rules: [
          { host: "pypi.org", verdict: "allow" },
          { host: "evil.example", verdict: "allow" },
        ],
      }),
    },
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    waiting: [{ host: "pypi.org", id: "req-1" }],
    blocked: [{ host: "evil.example" }],
  });
});
