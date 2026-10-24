// TEST_OVERVIEW: every array in a request from outside the api-server has one size limit, checked on the raw input before any schema parses an element. It covers every user and agent tRPC procedure (the e2e API included, whose access check runs only after the input is parsed) and every MCP tool call. The input schemas stay as they are, so the published tool schemas do not show the limit.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  hasOversizedArray,
  OVERSIZED_ARRAY_MESSAGE,
  type ApiContext,
  type HarnessContext,
} from "api-server-api";
import { harnessRouter } from "api-server-api/harness-router";
import { appRouter } from "api-server-api/router";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mountInvocationRoutes } from "../../apps/harness-api-server/invocation-endpoints.js";
import { rejectOversizedArrays } from "../../core/mcp-input-bounds.js";

const MAX = 100_000;

function watchedArray(length: number) {
  const reads = { count: 0 };
  const array = new Proxy(new Array<unknown>(length).fill("x"), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads.count++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { array, reads };
}

async function callEvery(
  router: typeof appRouter | typeof harnessRouter,
  caller: unknown,
) {
  const outcomes: Record<string, unknown> = {};
  for (const path of Object.keys(router._def.procedures)) {
    const { array, reads } = watchedArray(MAX + 1);
    const call = path
      .split(".")
      .reduce((node, key) => (node as Record<string, unknown>)[key], caller);
    const error = await Promise.resolve()
      .then(() => (call as (input: unknown) => unknown)({ nested: { array } }))
      .then(
        () => null,
        (err: { code?: string; message?: string }) => err,
      );
    outcomes[path] = {
      code: error?.code,
      message: error?.message,
      elementsRead: reads.count,
    };
  }
  return outcomes;
}

function expectAllRefused(outcomes: Record<string, unknown>) {
  const refused = {
    code: "BAD_REQUEST",
    message: OVERSIZED_ARRAY_MESSAGE,
    elementsRead: 0,
  };
  expect(outcomes).toEqual(
    Object.fromEntries(Object.keys(outcomes).map((path) => [path, refused])),
  );
}

describe("input array bounds", () => {
  // TEST_SCENARIO: a new procedure must get the limit without anyone adding it, so the check walks every procedure of both routers. An empty context proves the refusal comes before any access check, and the read count proves no element was parsed.
  it("refuses an oversized array on every user tRPC procedure before reading an element", async () => {
    expectAllRefused(
      await callEvery(appRouter, appRouter.createCaller({} as ApiContext)),
    );
  });

  // TEST_SCENARIO: agent pods call the harness router, so the same limit holds there.
  it("refuses an oversized array on every agent tRPC procedure before reading an element", async () => {
    expectAllRefused(
      await callEvery(
        harnessRouter,
        harnessRouter.createCaller({} as HarnessContext),
      ),
    );
  });

  // TEST_SCENARIO: the limit must not refuse a request at the limit, and must find an oversized array at any depth.
  it("allows an array at the limit and finds an oversized one deep inside", () => {
    expect(hasOversizedArray({ a: new Array(MAX).fill(0) })).toBe(false);
    expect(hasOversizedArray([{ a: [{ b: new Array(MAX + 1) }] }])).toBe(true);
  });

  // TEST_SCENARIO: an MCP tool's input schema parses every element, so an oversized argument must be refused before it, and the tool list a harness reads must not change.
  it("refuses an oversized MCP tool argument before its schema parses an element, and publishes no limit", async () => {
    let parsed = 0;
    const rpc = async (method: string, params: unknown) => {
      const server = new McpServer({ name: "probe", version: "1" });
      server.registerTool(
        "take",
        {
          inputSchema: {
            items: z.array(z.string().refine(() => ++parsed > 0)),
          },
        },
        async () => ({ content: [] }),
      );
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      rejectOversizedArrays(transport);
      const res = await transport.handleRequest(
        new Request("http://mcp/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
      return res.json();
    };

    const listed = await rpc("tools/list", {});
    const refused = await rpc("tools/call", {
      name: "take",
      arguments: { items: new Array(MAX + 1).fill("x") },
    });

    expect(
      listed.result.tools[0].inputSchema.properties.items,
    ).not.toHaveProperty("maxItems");
    expect(refused.error).toEqual({
      code: ErrorCode.InvalidParams,
      message: OVERSIZED_ARRAY_MESSAGE,
    });
    expect(parsed).toBe(0);
  });

  // TEST_SCENARIO: an agent pod also posts a spawn request as a plain JSON body, outside tRPC and MCP, so the same limit holds there.
  it("refuses an oversized array in an agent's spawn request body", async () => {
    const app = new Hono();
    mountInvocationRoutes(app, {
      readAgent: async () => ({
        metadata: {
          uid: "uid-1",
          labels: { "agent-platform.ai/owner": "owner-1" },
        },
        spec: {},
      }),
      invocationsServiceFor: () => ({}),
      connectionsServiceFor: () => ({}),
    } as never);

    const res = await app.request("/api/agents/driver-1/invocations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "go",
        schema: { type: "object" },
        connections: new Array(MAX + 1).fill("x"),
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: OVERSIZED_ARRAY_MESSAGE });
  });
});
