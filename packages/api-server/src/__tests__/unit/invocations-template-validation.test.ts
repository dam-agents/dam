import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import { mountInvocationRoutes } from "../../apps/harness-api-server/invocation-endpoints.js";
import { AGENTS_PLURAL } from "../../modules/agents/infrastructure/labels.js";

// TEST_OVERVIEW: A driver naming a template that doesn't exist: the catalogue is the

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
        { id: "nous", name: "NOUS", spec: {} },
        { id: "claude-code", name: "Claude Code", spec: {} },
      ],
      get: async () => null,
    } as never,
  });
  return { app, spawned };
}

const body = (templateId: string) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    prompt: "go",
    schema: { type: "object" },
    templateId,
  }),
});

describe("spawn template validation", () => {
  test("rejects an unknown template id, naming the available ones", async () => {
    const { app, spawned } = makeApp();

    const res = await app.request(
      "/api/agents/driver-1/invocations",
      body("nous-agent"),
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('unknown template "nous-agent"');
    expect(json.error).toContain("claude-code, nous");
    expect(spawned).toHaveLength(0);
  });

  test("passes a known template id through to spawn", async () => {
    const { app, spawned } = makeApp();

    const res = await app.request(
      "/api/agents/driver-1/invocations",
      body("nous"),
    );

    expect(res.status).toBe(201);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ templateId: "nous" });
  });
});
