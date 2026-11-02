// TEST_OVERVIEW: a request from outside the api-server has a byte limit and a tRPC batch has a length limit. The user tRPC HTTP endpoint answers 413 to a body over the limit before tRPC reads or parses it, whether the body declares its length or arrives chunked; a body exactly at the limit is parsed. The tRPC WebSocket closes a connection whose message is over the same limit before the message is parsed. Both tRPC HTTP endpoints, user and agent, refuse a batch over the length limit.
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { serve } from "@hono/node-server";
import {
  OVERSIZED_ARRAY_MESSAGE,
  type ApiContext,
  type KbPublishGate,
} from "api-server-api";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ApiVariables } from "../../apps/api-server/deps.js";
import { createTrpcHttpRoutes } from "../../apps/api-server/trpc/http.js";
import { createTrpcWsEndpoint } from "../../apps/api-server/trpc/ws.js";
import { mountRuntimeTrpc } from "../../apps/harness-api-server/runtime-trpc.js";
import {
  MAX_TRPC_BATCH_SIZE,
  MAX_USER_REQUEST_BODY_BYTES,
} from "../../core/request-body-bounds.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { LABEL_OWNER } from "../../modules/agents/infrastructure/labels.js";

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const s of servers.splice(0))
    await new Promise((r) => s.close(() => r(null)));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  if (!server.listening)
    await new Promise<void>((r) => server.once("listening", r));
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function userTrpc() {
  const composed = { count: 0 };
  const app = new Hono<{ Variables: ApiVariables }>();
  app.route(
    "/api/trpc",
    createTrpcHttpRoutes({
      composeApiContext: () => {
        composed.count++;
        return {} as ApiContext;
      },
    }),
  );
  const host = await listen(
    serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as Server,
  );
  return { base: `http://${host}/api/trpc`, composed };
}

function inputOfLength(bytes: number): string {
  const head = `{"nested":{"array":[${new Array(100_001).fill(0).join(",")}]},"pad":"`;
  return `${head}${"x".repeat(bytes - head.length - 2)}"}`;
}

function chunked(body: string): RequestInit {
  const bytes = new TextEncoder().encode(body);
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 1 << 20)
          controller.enqueue(bytes.subarray(i, i + (1 << 20)));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit;
}

const post = (body: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});

const batchPath = (path: string, size: number) =>
  `${new Array(size).fill(path).join(",")}?batch=1`;

describe("request body bounds", () => {
  // TEST_SCENARIO: a body with a declared length one byte over the limit gets 413 from the limit itself. No tRPC context is composed, so tRPC never read or parsed the body.
  it("answers 413 to a declared-length body over the limit before tRPC parses it", async () => {
    const { base, composed } = await userTrpc();
    const res = await fetch(
      `${base}/terms.accept`,
      post(inputOfLength(MAX_USER_REQUEST_BODY_BYTES + 1)),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: `request body exceeds ${MAX_USER_REQUEST_BODY_BYTES} bytes`,
    });
    expect(composed.count).toBe(0);
  });

  // TEST_SCENARIO: a chunked body declares no length, so the limit counts the bytes as they arrive and refuses the body once it passes the limit.
  it("answers 413 to a chunked body over the limit before tRPC parses it", async () => {
    const { base, composed } = await userTrpc();
    const res = await fetch(
      `${base}/terms.accept`,
      chunked(inputOfLength(MAX_USER_REQUEST_BODY_BYTES + 1)),
    );
    expect(res.status).toBe(413);
    expect(composed.count).toBe(0);
  });

  // TEST_SCENARIO: a body exactly at the limit, sent both ways, reaches the procedure: the oversized-array check answers it, which it can do only on parsed input.
  it("parses a body exactly at the limit", async () => {
    const { base } = await userTrpc();
    const body = inputOfLength(MAX_USER_REQUEST_BODY_BYTES);
    expect(Buffer.byteLength(body)).toBe(MAX_USER_REQUEST_BODY_BYTES);
    for (const init of [post(body), chunked(body)]) {
      const res = await fetch(`${base}/terms.accept`, init);
      expect(res.status).toBe(400);
      expect(
        ((await res.json()) as { error: { message: string } }).error.message,
      ).toBe(OVERSIZED_ARRAY_MESSAGE);
    }
  });

  // TEST_SCENARIO: a batch one call over the length limit is refused as a whole; a batch at the limit runs every call, and each call fails only its own input check.
  it("refuses a user tRPC batch over the length limit and runs one at the limit", async () => {
    const { base } = await userTrpc();
    const over = await fetch(
      `${base}/${batchPath("terms.accept", MAX_TRPC_BATCH_SIZE + 1)}`,
      post("{}"),
    );
    expect(over.status).toBe(400);
    expect(await over.text()).toContain("Batch call exceeds maximum size");

    const at = await fetch(
      `${base}/${batchPath("terms.accept", MAX_TRPC_BATCH_SIZE)}`,
      post("{}"),
    );
    const results = (await at.json()) as {
      error: { data: { code: string } };
    }[];
    expect(results).toHaveLength(MAX_TRPC_BATCH_SIZE);
    expect(new Set(results.map((r) => r.error.data.code))).toEqual(
      new Set(["BAD_REQUEST"]),
    );
  });

  // TEST_SCENARIO: agents' machines call the harness tRPC endpoint, so its batches have the same length limit.
  it("refuses an agent tRPC batch over the length limit", async () => {
    const app = new Hono();
    mountRuntimeTrpc(app, {
      readAgent: async () => ({
        metadata: { labels: { [LABEL_OWNER]: "owner" } },
      }),
      k8s: {
        getCustomObject: async () => ({
          metadata: { labels: { [LABEL_OWNER]: "owner" } },
        }),
      } as unknown as K8sClient,
      hello: {} as never,
      invocationScripts: {} as never,
      spendCalls: {} as never,
      sessionDirectory: {} as never,
      artifactTouchesFor: () => ({}) as never,
      kbPublish: {} as KbPublishGate,
      toolApprovalsFor: () => ({}) as never,
    });
    const url = (size: number) =>
      `http://h/api/agents/a1/trpc/${batchPath("kbPublish.request", size)}`;

    const over = await app.request(url(MAX_TRPC_BATCH_SIZE + 1), post("{}"));
    expect(over.status).toBe(400);
    expect(await over.text()).toContain("Batch call exceeds maximum size");

    const at = await app.request(url(MAX_TRPC_BATCH_SIZE), post("{}"));
    expect(await at.json()).toHaveLength(MAX_TRPC_BATCH_SIZE);
  });

  // TEST_SCENARIO: a WebSocket message over the limit closes the connection with 1009 before the server parses it, so the connection params it carries never reach authentication; a message exactly at the limit is parsed and its token reaches authentication.
  it("closes a tRPC WebSocket on a message over the limit and parses one at the limit", async () => {
    const tokens: unknown[] = [];
    const endpoint = createTrpcWsEndpoint({
      authenticate: async (token) => {
        tokens.push(token);
        return { ok: false, kind: "unauthorized" };
      },
      surfaceAttribution: { uiClientId: "ui", cliClientId: "cli" },
      composeApiContext: () => ({}) as ApiContext,
    });
    const server = createServer();
    server.on("upgrade", (req, socket, head) =>
      endpoint.handleUpgrade(req, socket, head),
    );
    const host = await listen(server.listen(0, "127.0.0.1"));

    const connectAndSend = async (bytes: number) => {
      const ws = new WebSocket(`ws://${host}/?connectionParams=1`);
      sockets.push(ws);
      const closed = new Promise<number>((r) =>
        ws.once("close", (code) => r(code)),
      );
      await new Promise((r) => ws.once("open", r));
      const head = `{"method":"connectionParams","data":{"token":"t${bytes}"},"pad":"`;
      ws.send(`${head}${"x".repeat(bytes - head.length - 2)}"}`);
      return closed;
    };

    expect(await connectAndSend(MAX_USER_REQUEST_BODY_BYTES + 1)).toBe(1009);
    expect(tokens).toEqual([]);

    await connectAndSend(MAX_USER_REQUEST_BODY_BYTES);
    expect(tokens).toEqual([`t${MAX_USER_REQUEST_BODY_BYTES}`]);
  });
});
