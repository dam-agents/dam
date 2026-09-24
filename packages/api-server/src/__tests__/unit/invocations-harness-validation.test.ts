import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import { mountInvocationRoutes } from "../../apps/harness-api-server/invocation-endpoints.js";
import { AGENTS_PLURAL } from "../../modules/agents/infrastructure/labels.js";

// TEST_OVERVIEW: A driver names a harness, and the spawn runs on that harness's Template. A harness the install does not carry is refused before anything is created, naming the harnesses it does carry.

function makeApp(opts: { spawn?: () => Promise<{ id: string }> } = {}) {
  const spawned: Array<Record<string, unknown>> = [];
  const app = new Hono();
  mountInvocationRoutes(app, {
    k8s: {
      getCustomObject: async (plural: string, id: string) =>
        plural === AGENTS_PLURAL && id === "driver-1"
          ? {
              metadata: {
                uid: "uid-1",
                labels: { "agent-platform.ai/owner": "owner-1" },
              },
              spec: {},
            }
          : null,
    } as never,
    invocationsServiceFor: () =>
      ({
        spawn: async (input: Record<string, unknown>) => {
          spawned.push(input);
          return opts.spawn ? opts.spawn() : { id: "target-1" };
        },
      }) as never,
    connectionsServiceFor: () =>
      ({
        listConnections: async () => [],
        getAgentConnections: async () => ({ connections: [] }),
      }) as never,
    templates: {
      list: async () => [
        { id: "pi-agent", name: "Pi", spec: { harness: "pi" } },
        {
          id: "claude-code",
          name: "Claude Code",
          spec: { harness: "claude-code" },
        },
      ],
      get: async () => null,
    } as never,
    budgetsFor: () =>
      ({
        reserved: async () => ({
          cpu: { reservedMilli: 0, ceilingMilli: 6000 },
          memory: { reservedBytes: 0, ceilingBytes: 14 * 1024 ** 3 },
        }),
      }) as never,
    defaultLimits: { cpu: "1", memory: "1Gi" },
  });
  return { app, spawned };
}

const body = (harness: string) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    prompt: "go",
    schema: { type: "object" },
    harness,
  }),
});

describe("spawn harness validation", () => {
  test("rejects a harness the install does not carry, naming the ones it does", async () => {
    const { app, spawned } = makeApp();

    const res = await app.request(
      "/api/agents/driver-1/invocations",
      body("codex"),
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('no harness "codex" on this install');
    expect(json.error).toContain("claude-code, pi");
    expect(spawned).toHaveLength(0);
  });

  test("runs a known harness on its Template", async () => {
    const { app, spawned } = makeApp();

    const res = await app.request(
      "/api/agents/driver-1/invocations",
      body("pi"),
    );

    expect(res.status).toBe(201);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ target: { templateId: "pi-agent" } });
  });
});
