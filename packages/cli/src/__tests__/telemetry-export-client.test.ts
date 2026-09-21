import { describe, expect, it } from "vitest";

import {
  createExportClient,
  exportPath,
} from "../modules/telemetry/infrastructure/export-client.js";

/**
 * TEST_OVERVIEW: the export is the one timeline read that leaves tRPC, so the
 * request it builds and the failures it reports are its own to get right.
 */

const ok = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers });

describe("exportPath", () => {
  it("carries the scope the server needs", () => {
    const path = exportPath({
      agentId: "agent-1",
      sessionId: "sess-1",
      signal: "logs",
      sinceHours: 24,
    });

    expect(path).toContain("agentId=agent-1");
    expect(path).toContain("sessionId=sess-1");
    expect(path).toContain("signal=logs");
    expect(path).toContain("sinceHours=24");
  });

  it("omits the session when the whole agent is wanted", () => {
    const path = exportPath({
      agentId: "agent-1",
      signal: "spans",
      sinceHours: 1,
    });

    expect(path).not.toContain("sessionId");
  });
});

describe("createExportClient", () => {
  const req = {
    agentId: "agent-1",
    sessionId: "sess-1",
    signal: "logs" as const,
    sinceHours: 24,
  };

  it("sends the bearer token and returns the body", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const client = createExportClient({
      host: "https://platform.example",
      getToken: async () => "tok-123",
      fetch: async (input, init) => {
        seen = {
          url: String(input),
          auth:
            (init?.headers as Record<string, string> | undefined)
              ?.authorization ?? null,
        };
        return ok('{"a":1}\n');
      },
    });

    const outcome = await client.run(req);

    expect(outcome).toEqual({
      kind: "ok",
      body: '{"a":1}\n',
      truncated: false,
    });
    expect(seen!.url).toContain(
      "https://platform.example/api/telemetry/export",
    );
    expect(seen!.auth).toBe("Bearer tok-123");
  });

  it("reports the cap so the caller knows the file is partial", async () => {
    const client = createExportClient({
      host: "https://platform.example",
      getToken: async () => "tok",
      fetch: async () => ok("{}\n", { "x-platform-truncated": "true" }),
    });

    const outcome = await client.run(req);

    expect(outcome.kind === "ok" && outcome.truncated).toBe(true);
  });

  it("surfaces the reason the server gave, not just its status", async () => {
    /**
     * TEST_SCENARIO: a store with no tables answers 502 with an explanation an
     * operator can act on, and it would be lost if only the status were shown.
     */
    const client = createExportClient({
      host: "https://platform.example",
      getToken: async () => "tok",
      fetch: async () =>
        new Response(JSON.stringify({ error: "no tables yet" }), {
          status: 502,
        }),
    });

    const outcome = await client.run(req);

    expect(outcome).toEqual({
      kind: "failed",
      status: 502,
      reason: "no tables yet",
    });
  });

  it("falls back to the status text when the body is not JSON", async () => {
    const client = createExportClient({
      host: "https://platform.example",
      getToken: async () => "tok",
      fetch: async () => new Response("nope", { status: 500 }),
    });

    const outcome = await client.run(req);

    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.status).toBe(500);
  });

  it("does not call the server when there is no token", async () => {
    let called = false;
    const client = createExportClient({
      host: "https://platform.example",
      getToken: async () => null,
      fetch: async () => {
        called = true;
        return ok("");
      },
    });

    const outcome = await client.run(req);

    expect(called).toBe(false);
    expect(outcome.kind === "failed" && outcome.status).toBe(401);
  });
});
