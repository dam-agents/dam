/**
 * TEST_OVERVIEW: The Model Router forwards each model call to the provider
 * Connection its model name picks, with that Connection's placeholder in the
 * header it claims at the credential gateway and the model rewritten to the
 * upstream id. A qualified name routes outright; a bare name resolves on the
 * session's provider, then the harness's default provider, then the single
 * provider listing it, and is refused when several do. A dialect the provider
 * does not serve is refused. Responses stream back with only the model field
 * rewritten to the name the harness asked for, on every dialect. The
 * platform's self-hosted endpoint takes no key, so its calls carry none.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
  ModelMetadata,
} from "../../modules/model-catalog/index.js";
import type { RuntimeEnvState } from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import {
  createModelRouter,
  HARNESS_HEADER,
  type ModelCallRecord,
  type ModelRouter,
} from "../../modules/model-router/index.js";

interface Seen {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

const seen: Seen[] = [];
const hanging: import("node:http").ServerResponse[] = [];
let upstream: Server;
let upstreamBase: string;
let router: ModelRouter;
const calls: ModelCallRecord[] = [];

function sse(events: unknown[]): string {
  return events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<
          string,
          unknown
        >)
      : {};
    seen.push({ path: req.url ?? "", headers: req.headers, body });
    const model = String(body.model);
    const stream = body.stream === true;
    const path = req.url ?? "";
    if (req.headers["x-test-status"]) {
      res.writeHead(Number(req.headers["x-test-status"]), {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({ error: { message: "nope" } }));
      return;
    }
    if (req.headers["x-test-hang"]) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        sse([
          {
            type: "message_start",
            message: { id: "m1", model, usage: { input_tokens: 7 } },
          },
        ]),
      );
      hanging.push(res);
      return;
    }
    if (path.endsWith("/v1/messages/count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ input_tokens: 5 }));
      return;
    }
    if (path.endsWith("/v1/messages")) {
      if (stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          sse([
            {
              type: "message_start",
              message: { id: "m1", model, usage: { input_tokens: 1 } },
            },
            { type: "message_delta", delta: {}, usage: { output_tokens: 2 } },
          ]),
        );
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ id: "m1", type: "message", model, content: [] }),
        );
      }
      return;
    }
    if (path.endsWith("/v1/chat/completions")) {
      res.writeHead(200, {
        "content-type": stream ? "text/event-stream" : "application/json",
      });
      res.end(
        stream
          ? `${sse([{ id: "c", model, choices: [] }])}data: [DONE]\n\n`
          : JSON.stringify({ id: "c", model, choices: [] }),
      );
      return;
    }
    if (path.endsWith("/v1/responses")) {
      res.writeHead(200, {
        "content-type": stream ? "text/event-stream" : "application/json",
      });
      res.end(
        stream
          ? sse([
              { type: "response.created", response: { id: "r", model } },
              {
                type: "response.completed",
                response: { id: "r", model, usage: {} },
              },
            ])
          : JSON.stringify({ id: "r", model, output: [] }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const addr = upstream.address();
  upstreamBase = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const metadata: ModelMetadata = {
    contextWindow: null,
    maxOutputTokens: null,
    reasoning: null,
    vision: null,
    cacheControl: null,
    thinkingFormat: null,
    prices: null,
    source: { limits: "none", prices: "none" },
  };
  const entry = (
    p: Pick<
      CatalogProvider,
      "alias" | "connectionId" | "template" | "dialects"
    >,
    upstreamId: string,
  ): CatalogEntry => ({
    name: `${p.alias}/${upstreamId}`,
    alias: p.alias,
    connectionId: p.connectionId,
    template: p.template,
    upstreamId,
    dialects: p.dialects,
    metadata,
  });
  const all = [
    "anthropic-messages",
    "openai-chat",
    "openai-responses",
  ] as const;
  const ibm = {
    alias: "ibm" as const,
    connectionId: "conn-ibm",
    template: "ibm-litellm",
    dialects: all,
  };
  const cb = {
    alias: "cb" as const,
    connectionId: "conn-cb",
    template: "curve-bender",
    dialects: all,
  };
  const anthropic = {
    alias: "anthropic" as const,
    connectionId: "conn-ant",
    template: "anthropic",
    dialects: ["anthropic-messages"] as const,
  };
  const platform = {
    alias: "platform" as const,
    connectionId: "conn-platform",
    template: "platform-llm",
    dialects: all,
  };
  const providers: CatalogProvider[] = [
    {
      ...cb,
      displayName: "CB",
      status: "listed",
      listedAt: null,
      entries: [
        entry(cb, "rits/zai-org/glm-5-3"),
        entry(cb, "gpt-5.5"),
        entry(cb, "rits/NVIDIA-Big"),
      ],
    },
    {
      ...ibm,
      displayName: "IBM",
      status: "listed",
      listedAt: null,
      entries: [
        entry(ibm, "aws/claude-opus-4-8"),
        entry(ibm, "gpt-5.5"),
        entry(ibm, "only-here"),
      ],
    },
    {
      ...anthropic,
      displayName: "Anthropic",
      status: "listed",
      listedAt: null,
      entries: [entry(anthropic, "claude-opus-4-8")],
    },
    {
      ...platform,
      displayName: "Platform",
      status: "listed",
      listedAt: null,
      entries: [entry(platform, "deepseek-v4.1-flash")],
    },
  ];
  router = createModelRouter({
    catalog: { providers: () => providers },
    envState: (): RuntimeEnvState => ({
      env: {},
      harnesses: [],
      providers: [
        {
          id: "conn-ibm",
          template: "ibm-litellm",
          env: {
            OPENAI_BASE_URL: `${upstreamBase}/ibm`,
            OPENAI_API_KEY: "platform:conn:conn-ibm",
          },
        },
        {
          id: "conn-cb",
          template: "curve-bender",
          env: {
            ANTHROPIC_BASE_URL: `${upstreamBase}/cb`,
            ANTHROPIC_AUTH_TOKEN: "sk-platform:conn:conn-cb",
          },
        },
        {
          id: "conn-ant",
          template: "anthropic",
          env: {
            ANTHROPIC_BASE_URL: `${upstreamBase}/ant`,
            ANTHROPIC_API_KEY: "platform:conn:conn-ant",
          },
        },
        {
          id: "conn-platform",
          template: "platform-llm",
          env: {
            PLATFORM_LLM_BASE_URL: `${upstreamBase}/platform`,
            OPENAI_BASE_URL: `${upstreamBase}/elsewhere/v1`,
            OPENAI_API_KEY: "placeholder",
            ANTHROPIC_AUTH_TOKEN: "placeholder",
          },
        },
      ],
    }),
    harnesses: {
      "claude-code": {
        dialects: ["anthropic-messages"],
        namePrefix: "claude/",
        lowercaseNames: true,
      },
      codex: { dialects: ["openai-responses"] },
      pi: { dialects: [...all] },
      bob: {
        dialects: ["openai-chat"],
        modelFromSession: true,
        tierAliases: ["premium"],
        bobGateway: true,
      },
    },
    defaultHarness: "claude-code",
    sessionOf: (req) => {
      const id = req.headers["x-test-session"] as string | undefined;
      const parent = req.headers["x-test-parent"] as string | undefined;
      return id
        ? { sessionId: id, ...(parent && { parentSessionId: parent }) }
        : null;
    },
    sessionModelOf: (id) =>
      id === "s-cb"
        ? { model: "cb/rits/zai-org/glm-5-3" }
        : id === "s-effort"
          ? { model: null, subagentEffort: "low" }
          : null,
    onCall: (r) => calls.push(r),
    port: 0,
    log: () => {},
  });
  await router.listen();
});

afterAll(async () => {
  for (const res of hanging) res.end();
  await router.close();
  upstream.close();
});

async function call(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  text: string;
  json: Record<string, unknown> | null;
}> {
  const r = await fetch(`${router.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer client-secret-never-forwarded",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {}
  return { status: r.status, text, json };
}

describe("routing by qualified name", () => {
  /** TEST_SCENARIO: Claude Code names a Curve Bender model under its
   * `claude/` prefix, lowercased; the call leaves for Curve Bender's host with
   * its placeholder as a bearer and the upstream id spelled as served, and the
   * client's own credential is dropped. The same body naming IBM leaves for
   * IBM with IBM's placeholder, stamped with the harness. */
  it("sends each call to its provider with that provider's placeholder", async () => {
    seen.length = 0;
    const a = await call(
      "/v1/messages",
      { model: "claude/cb/rits/nvidia-big", messages: [] },
      { [HARNESS_HEADER]: "claude-code" },
    );
    expect(a.status).toBe(200);
    expect(seen[0]!.path).toBe("/cb/v1/messages");
    expect(seen[0]!.headers.authorization).toBe(
      "Bearer sk-platform:conn:conn-cb",
    );
    expect(seen[0]!.body.model).toBe("rits/NVIDIA-Big");
    expect(a.json?.model).toBe("claude/cb/rits/nvidia-big");

    const b = await call(
      "/v1/messages",
      { model: "claude/ibm/aws/claude-opus-4-8", messages: [] },
      { [HARNESS_HEADER]: "claude-code" },
    );
    expect(b.status).toBe(200);
    expect(seen[1]!.path).toBe("/ibm/v1/messages");
    expect(seen[1]!.headers.authorization).toBe(
      "Bearer platform:conn:conn-ibm",
    );
    expect(seen[1]!.headers[HARNESS_HEADER]).toBe("claude-code");
    expect(seen[1]!.body.model).toBe("aws/claude-opus-4-8");
  });

  /** TEST_SCENARIO: The Anthropic key claims `x-api-key`; a chat call to it
   * is refused with the dialect reason because it serves Messages only, while
   * a Responses call to Curve Bender is forwarded. */
  it("refuses a dialect the provider does not serve and claims the Anthropic key's header", async () => {
    seen.length = 0;
    const chat = await call(
      "/v1/chat/completions",
      { model: "anthropic/claude-opus-4-8", messages: [] },
      { [HARNESS_HEADER]: "pi" },
    );
    expect(chat.status).toBe(400);
    expect(chat.text).toContain("does not serve the openai-chat API");
    const messages = await call(
      "/v1/messages",
      { model: "anthropic/claude-opus-4-8", messages: [] },
      { [HARNESS_HEADER]: "pi" },
    );
    expect(messages.status).toBe(200);
    expect(seen[0]!.headers["x-api-key"]).toBe("platform:conn:conn-ant");
    expect(seen[0]!.headers.authorization).toBeUndefined();
    const responses = await call(
      "/v1/responses",
      { model: "cb/gpt-5.5", input: [] },
      { [HARNESS_HEADER]: "codex" },
    );
    expect(responses.status).toBe(200);
    expect(seen[1]!.path).toBe("/cb/v1/responses");
    expect(seen.length).toBe(2);
  });

  /** TEST_SCENARIO: A call on each of the three dialects leaves for the
   * platform's root carrying the layer's bearer placeholder, which names the
   * Connection at the gateway, and not the client's own key. */
  it("sends the bearer placeholder to the platform's endpoint on any dialect", async () => {
    seen.length = 0;
    for (const [path, harness] of [
      ["/v1/messages", "pi"],
      ["/v1/chat/completions", "pi"],
      ["/v1/responses", "codex"],
    ] as const) {
      const r = await call(
        path,
        { model: "platform/deepseek-v4.1-flash", messages: [] },
        { [HARNESS_HEADER]: harness, "x-api-key": "client-key" },
      );
      expect(r.status).toBe(200);
    }
    expect(seen.map((s) => s.path)).toEqual([
      "/platform/v1/messages",
      "/platform/v1/chat/completions",
      "/platform/v1/responses",
    ]);
    for (const s of seen) {
      expect(s.headers.authorization).toBe("Bearer placeholder");
      expect(s.headers["x-api-key"]).toBeUndefined();
      expect(s.body.model).toBe("deepseek-v4.1-flash");
    }
  });
  /** TEST_SCENARIO: An unknown qualified name is refused naming the granted
   * aliases, and a body with no model is refused; nothing reaches upstream. */
  it("refuses unknown names without calling upstream", async () => {
    seen.length = 0;
    const unknown = await call(
      "/v1/responses",
      { model: "cb/nope" },
      { [HARNESS_HEADER]: "codex" },
    );
    expect(unknown.status).toBe(404);
    expect(unknown.text).toContain(
      "granted providers: cb, ibm, anthropic, platform",
    );
    const none = await call(
      "/v1/responses",
      { input: [] },
      { [HARNESS_HEADER]: "codex" },
    );
    expect(none.status).toBe(400);
    expect(seen).toEqual([]);
  });
});

describe("Bob's calls", () => {
  /** TEST_SCENARIO: Bob cannot switch its model per session and stamps no
   * harness header: every call names the model its settings file holds
   * (the first catalog model, a Claude model), under its compiled-in
   * `/inference` prefix. A session that picked a Curve Bender model must
   * still run on it, so the prefix names the call as Bob's and the session's
   * pick replaces the body's model; the record says Bob, not the install's
   * default harness. */
  it("routes on the session's model, not the settings-file model", async () => {
    seen.length = 0;
    const r = await call(
      "/inference/v1/chat/completions",
      { model: "ibm/aws/claude-opus-4-8" },
      { "x-test-session": "s-cb" },
    );
    expect(r.status).toBe(200);
    expect(seen.at(-1)?.path).toMatch(/\/v1\/chat\/completions$/);
    expect(seen.at(-1)?.body.model).toBe("rits/zai-org/glm-5-3");
    expect(calls.at(-1)).toMatchObject({
      harness: "bob",
      alias: "cb",
      upstreamId: "rits/zai-org/glm-5-3",
    });
  });
});

describe("subagent effort", () => {
  /** TEST_SCENARIO: The session set its subagents' effort to low. A call the
   * harness marks as a subagent's runs at low in its dialect's field, while
   * the session's own call keeps its effort, and a subagent call that
   * carries no effort (the harness sends none to a model that takes none)
   * gets none added. */
  it("overwrites only the effort a subagent's call carries", async () => {
    seen.length = 0;
    const subagent = { "x-test-session": "child", "x-test-parent": "s-effort" };
    await call(
      "/v1/messages",
      {
        model: "claude/anthropic/claude-opus-4-8",
        output_config: { effort: "high" },
      },
      subagent,
    );
    expect(seen.at(-1)?.body.output_config).toEqual({ effort: "low" });
    await call(
      "/v1/responses",
      { model: "ibm/gpt-5.5", reasoning: { effort: "xhigh", summary: "auto" } },
      { ...subagent, [HARNESS_HEADER]: "codex" },
    );
    expect(seen.at(-1)?.body.reasoning).toEqual({
      effort: "low",
      summary: "auto",
    });
    await call(
      "/v1/messages",
      {
        model: "claude/anthropic/claude-opus-4-8",
        output_config: { effort: "high" },
      },
      { "x-test-session": "s-effort" },
    );
    expect(seen.at(-1)?.body.output_config).toEqual({ effort: "high" });
    await call(
      "/v1/messages",
      { model: "claude/anthropic/claude-opus-4-8" },
      subagent,
    );
    expect(seen.at(-1)?.body).not.toHaveProperty("output_config");
  });
});

describe("bare names", () => {
  /** TEST_SCENARIO: `gpt-5.5` is listed by IBM and Curve Bender. With a
   * session on Curve Bender it goes there; with no session it goes to the
   * harness's default provider (IBM first in alias order); a name only IBM
   * lists resolves to IBM even from a Curve Bender session; a name nobody
   * lists is refused. */
  it("resolves on the session, then the default provider, then the single lister", async () => {
    seen.length = 0;
    await call(
      "/v1/responses",
      { model: "gpt-5.5" },
      { [HARNESS_HEADER]: "codex", "x-test-session": "s-cb" },
    );
    expect(seen[0]!.path).toBe("/cb/v1/responses");
    await call(
      "/v1/responses",
      { model: "gpt-5.5" },
      { [HARNESS_HEADER]: "codex" },
    );
    expect(seen[1]!.path).toBe("/ibm/v1/responses");
    await call(
      "/v1/responses",
      { model: "only-here" },
      { [HARNESS_HEADER]: "codex", "x-test-session": "s-cb" },
    );
    expect(seen[2]!.path).toBe("/ibm/v1/responses");
    const missing = await call(
      "/v1/responses",
      { model: "nobody" },
      { [HARNESS_HEADER]: "codex" },
    );
    expect(missing.status).toBe(404);
    expect(missing.text).toContain("no granted provider lists model 'nobody'");
  });

  /** TEST_SCENARIO: Claude Code's bare `claude-opus-4-8` is not on the
   * default provider (IBM lists it only under its `aws/` deployment prefix),
   * so the single provider listing it, the Anthropic key, answers, and the
   * response names that provider under Claude Code's prefix. */
  it("picks the default among the providers serving the harness", async () => {
    seen.length = 0;
    const r = await call(
      "/v1/messages",
      { model: "claude-opus-4-8", messages: [] },
      { [HARNESS_HEADER]: "claude-code" },
    );
    expect(r.status).toBe(200);
    expect(seen[0]!.path).toBe("/ant/v1/messages");
    expect(r.json?.model).toBe("claude/anthropic/claude-opus-4-8");
  });
});

describe("response model rewrite", () => {
  /** TEST_SCENARIO: On all three dialects, streamed and not, the response's
   * model field reads the name the harness asked for, and the rest of the
   * stream is untouched. */
  it("rewrites the model field on every dialect", async () => {
    const m = await call(
      "/v1/messages",
      { model: "cb/rits/zai-org/glm-5-3", stream: true },
      { [HARNESS_HEADER]: "pi" },
    );
    expect(m.text).toContain('"model":"cb/rits/zai-org/glm-5-3"');
    expect(m.text).toContain('"usage":{"output_tokens":2}');
    const c = await call(
      "/v1/chat/completions",
      { model: "cb/gpt-5.5", stream: true },
      { [HARNESS_HEADER]: "pi" },
    );
    expect(c.text).toContain('"model":"cb/gpt-5.5"');
    expect(c.text).toContain("data: [DONE]");
    const r = await call(
      "/v1/responses",
      { model: "ibm/gpt-5.5", stream: true },
      { [HARNESS_HEADER]: "codex" },
    );
    expect(r.text.match(/"model":"ibm\/gpt-5.5"/g)).toHaveLength(2);
    const plain = await call(
      "/v1/chat/completions",
      { model: "cb/gpt-5.5" },
      { [HARNESS_HEADER]: "pi" },
    );
    expect(plain.json?.model).toBe("cb/gpt-5.5");
  });

  /** TEST_SCENARIO: Every forwarded call is reported once with its Connection,
   * upstream model, dialect, harness and status, and no cost: the gateway
   * measures that. A streamed Messages call reports the tokens its
   * `message_start` and `message_delta` events carried. A chat completion
   * answered without a usage field is uncounted. The harness's trace context
   * rides along. */
  it("reports each call with its usage, marking usage-less ones", async () => {
    await call(
      "/v1/messages",
      { model: "claude/ibm/aws/claude-opus-4-8", stream: true },
      {
        [HARNESS_HEADER]: "claude-code",
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      },
    );
    expect(calls.at(-1)).toMatchObject({
      connectionId: "conn-ibm",
      alias: "ibm",
      upstreamId: "aws/claude-opus-4-8",
      requestedModel: "claude/ibm/aws/claude-opus-4-8",
      dialect: "anthropic-messages",
      harness: "claude-code",
      stream: true,
      status: 200,
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      uncounted: null,
      trace: {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
      },
    });
    await call(
      "/v1/chat/completions",
      { model: "cb/gpt-5.5" },
      { [HARNESS_HEADER]: "pi" },
    );
    expect(calls.at(-1)).toMatchObject({
      connectionId: "conn-cb",
      dialect: "openai-chat",
      harness: "pi",
      stream: false,
      status: 200,
      usage: null,
      uncounted: "no-usage-event",
      trace: null,
    });
  });

  /** TEST_SCENARIO: A provider refuses a model with 403. A retry cannot
   * change that, yet the harnesses' SDKs retry it for a minute unless told
   * not to, so the reply says not to and names the provider, model and API;
   * a 429 keeps its retries. */
  it("fails a permanent provider error fast and says where it came from", async () => {
    const send = (status: string) =>
      fetch(`${router.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HARNESS_HEADER]: "pi",
          "x-test-status": status,
        },
        body: JSON.stringify({ model: "cb/gpt-5.5" }),
      });
    const refused = await send("403");
    expect(refused.status).toBe(403);
    expect(refused.headers.get("x-should-retry")).toBe("false");
    const body = (await refused.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(
      /refused gpt-5\.5 with HTTP 403 on the OpenAI Chat Completions API, which pi uses\. The provider said: nope$/,
    );
    const limited = await send("429");
    expect(limited.headers.get("x-should-retry")).toBeNull();
  });

  /** TEST_SCENARIO: Claude Code counts a prompt's tokens before sending it.
   * The count is forwarded like a model call, but a provider answers it for
   * free and without a usage block, so it gets no spend record: Usage never
   * shows it as an uncounted call. */
  it("forwards a token count without a spend record", async () => {
    const before = calls.length;
    const res = await call(
      "/v1/messages/count_tokens",
      { model: "claude/ibm/aws/claude-opus-4-8" },
      { [HARNESS_HEADER]: "claude-code" },
    );
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ input_tokens: 5 });
    expect(seen.at(-1)?.path.endsWith("/v1/messages/count_tokens")).toBe(true);
    expect(calls.length).toBe(before);
  });

  /** TEST_SCENARIO: The harness cancels a turn while the response is still
   * streaming. The upstream fetch is aborted and the call is reported once,
   * as cut short with no usage, so Usage shows an uncounted call rather than
   * nothing or a partial count. */
  it("reports a call cut mid-stream once, as uncounted", async () => {
    const before = calls.length;
    const ac = new AbortController();
    const res = await fetch(`${router.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HARNESS_HEADER]: "claude-code",
        "x-test-hang": "1",
      },
      body: JSON.stringify({ model: "claude/ibm/gpt-5.5", stream: true }),
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    for (let i = 0; i < 50 && calls.length === before; i += 1)
      await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(before + 1);
    expect(calls.at(-1)).toMatchObject({
      status: 499,
      stream: true,
      usage: null,
      uncounted: "no-usage-event",
    });
  });

  /** TEST_SCENARIO: Claude Code probes its gateway with HEAD /api/hello and
   * anything else unknown is a JSON 404, and pi-ai's doubled `/v1/v1/` path
   * still reaches the Messages route. */
  it("answers the hello probe, folds pi-ai's doubled path and 404s the rest", async () => {
    const hello = await fetch(`${router.baseUrl}/api/hello`, {
      method: "HEAD",
    });
    expect(hello.status).toBe(200);
    const doubled = await call(
      "/v1/v1/messages",
      { model: "cb/rits/zai-org/glm-5-3" },
      { [HARNESS_HEADER]: "pi" },
    );
    expect(doubled.status).toBe(200);
    const other = await fetch(`${router.baseUrl}/v1/nothing`);
    expect(other.status).toBe(404);
    expect(
      ((await other.json()) as { error: { message: string } }).error.message,
    ).toContain("no route");
  });
});
