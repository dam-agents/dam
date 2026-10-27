import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import { mountInvocationRoutes } from "../../apps/harness-api-server/invocation-endpoints.js";
import {
  scriptSpawningSession,
  type DriverSessions,
  type SessionNamed,
} from "../../apps/harness-api-server/spawning-session.js";

// TEST_OVERVIEW: a driver script's spawn records the Driver's Session the script runs in, so its sub-agent shows only in that Session's chat. The SDK names the Session in a header, the endpoint asks the Driver's runtime which Session that is, and a spawn that names none, or one the runtime does not know, records none and still runs, shown in every chat as before.

function makeApp(resolve: (named: SessionNamed) => Promise<string | null>) {
  const spawned: Array<Record<string, unknown>> = [];
  const asked: SessionNamed[] = [];
  const app = new Hono();
  const record = async (input: Record<string, unknown>) => {
    spawned.push(input);
    return { id: "target-1" };
  };
  mountInvocationRoutes(app, {
    agents: { get: async () => null },
    scriptOutputs: {} as never,
    spawningSession: async (driverId, named) => {
      expect(driverId).toBe("driver-1");
      asked.push(named);
      return resolve(named);
    },
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
    invocationsServiceFor: () =>
      ({ spawn: record, spawnScript: record }) as never,
    connectionsServiceFor: () =>
      ({
        listConnections: async () => [],
        getAgentConnections: async () => ({ connections: [] }),
      }) as never,
    templates: {
      list: async () => [
        { id: "pi-agent", name: "Pi", spec: { harness: "pi" } },
      ],
      get: async () => null,
    } as never,
    harnesses: {
      default: "pi",
      harnesses: [],
      telemetryEnv: () => [],
    },
    budgetsFor: () => ({}) as never,
  });
  return { app, spawned, asked };
}

const post = (body: object, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ harness: "pi", ...body }),
});

const PROMPT = { prompt: "go", schema: { type: "object" } };
const SCRIPT = { script: "make test" };

describe("a driver script's spawn", () => {
  test.each([
    ["prompt", PROMPT],
    ["script", SCRIPT],
  ])("a %s spawn records the Session its ref names", async (_kind, body) => {
    const { app, spawned, asked } = makeApp(async (named) =>
      named.ref === "ref-a" ? "session-a" : null,
    );

    const res = await app.request(
      "/api/agents/driver-1/invocations",
      post(body, { "x-platform-session-ref": "ref-a" }),
    );

    expect(res.status).toBe(201);
    expect(asked).toEqual([{ ref: "ref-a" }]);
    expect(spawned[0]).toMatchObject({
      origin: "script",
      driverSessionId: "session-a",
    });
  });

  test("a spawn passes both the ref and the Session id it names", async () => {
    const { app, spawned, asked } = makeApp(async () => "session-b");

    await app.request(
      "/api/agents/driver-1/invocations",
      post(PROMPT, {
        "x-platform-session-ref": "ref-b",
        "x-platform-session-id": "session-b",
      }),
    );

    expect(asked).toEqual([{ ref: "ref-b", sessionId: "session-b" }]);
    expect(spawned[0]).toMatchObject({ driverSessionId: "session-b" });
  });

  test.each([
    ["no header", {}],
    ["Pi's blank ref", { "x-platform-session-ref": " " }],
  ])(
    "a spawn with %s asks nothing and records no Session",
    async (_case, headers) => {
      const { app, spawned, asked } = makeApp(async () => "never");

      const res = await app.request(
        "/api/agents/driver-1/invocations",
        post(PROMPT, headers),
      );

      expect(res.status).toBe(201);
      expect(asked).toEqual([]);
      expect(spawned[0]).toMatchObject({
        origin: "script",
        driverSessionId: null,
      });
    },
  );

  test("a Session the runtime does not know still spawns, with none recorded", async () => {
    const { app, spawned } = makeApp(async () => null);

    const res = await app.request(
      "/api/agents/driver-1/invocations",
      post(SCRIPT, { "x-platform-session-ref": "ref-gone" }),
    );

    expect(res.status).toBe(201);
    expect(spawned[0]).toMatchObject({ driverSessionId: null });
  });
});

function sessions(
  over: Partial<DriverSessions> = {},
): DriverSessions & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    byRef: async (ref) => {
      asked.push(`ref:${ref}`);
      return ref === "ref-a" ? "session-a" : null;
    },
    knows: async (sessionId) => {
      asked.push(`id:${sessionId}`);
      return sessionId === "session-b";
    },
    ...over,
  };
}

describe("resolving the script's Session", () => {
  test("a ref the runtime knows names its Session", async () => {
    const runtime = sessions();
    const resolve = scriptSpawningSession(() => runtime);

    expect(
      await resolve("driver-1", { ref: "ref-a", sessionId: "session-b" }),
    ).toBe("session-a");
    expect(runtime.asked).toEqual(["ref:ref-a"]);
  });

  test("a Session id counts only when the runtime tracks that Session", async () => {
    const runtime = sessions();
    const warnings: string[] = [];
    const resolve = scriptSpawningSession(
      () => runtime,
      (m) => warnings.push(m),
    );

    expect(
      await resolve("driver-1", { ref: "ref-x", sessionId: "session-b" }),
    ).toBe("session-b");
    expect(await resolve("driver-1", { sessionId: "pi-own-id" })).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  test("a runtime that does not answer records no Session, and says so", async () => {
    const warnings: string[] = [];
    const resolve = scriptSpawningSession(
      () =>
        sessions({
          byRef: async () => {
            throw new Error("connect ECONNREFUSED");
          },
        }),
      (m) => warnings.push(m),
    );

    expect(await resolve("driver-1", { ref: "ref-a" })).toBeNull();
    expect(warnings).toEqual([
      expect.stringContaining("could not resolve the script's session"),
    ]);
  });
});
