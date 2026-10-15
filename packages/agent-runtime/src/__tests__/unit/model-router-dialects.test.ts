/**
 * TEST_OVERVIEW: The Model Router's per-harness wire contract beyond the three
 * model routes: the catalog endpoints each harness reads (`/v1/models` for
 * Claude Code and Pi, Codex's catalog with every field its 0.158 ModelInfo
 * requires, Bob's LiteLLM-shaped model-info under `/inference/v1`), the
 * session handle each harness stamps on its calls, Bob's per-session model
 * rewrite and tier-alias mapping, the three replay rules, the usage
 * chunk injection for streamed chat completions, and the Anthropic
 * subscription token routed for Claude Code alone with its OAuth beta flag.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
  ModelMetadata,
} from "../../modules/model-catalog/index.js";
import { forHarness } from "../../modules/model-catalog/index.js";
import { explainUpstreamError } from "../../modules/model-router/domain/upstream-error.js";
import type { ModelRouterBinding } from "../../modules/runtime-channel/manifest.js";
import type { RuntimeEnvState } from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import {
  applyReplayRules,
  composeModelRouter,
  dropUnsupportedReasoning,
  fitOutputBudget,
  ensureStreamUsage,
  floorOutputBudget,
  HARNESS_HEADER,
  sessionOf,
  type ModelRouter,
} from "../../modules/model-router/index.js";

const seen: {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}[] = [];
let upstream: Server;
let router: ModelRouter;

const HARNESSES: Record<string, ModelRouterBinding> = {
  "claude-code": {
    dialects: ["anthropic-messages"],
    namePrefix: "claude/",
    lowercaseNames: true,
  },
  codex: { dialects: ["openai-responses"], bareNamesFromSession: true },
  pi: { dialects: ["openai-responses", "openai-chat", "anthropic-messages"] },
  bob: {
    dialects: ["openai-chat"],
    modelFromSession: true,
    tierAliases: ["premium-ide", "explorer", "fast", "premium", "ultra"],
  },
};

function metadata(over: Partial<ModelMetadata> = {}): ModelMetadata {
  return {
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    reasoning: true,
    vision: true,
    cacheControl: null,
    thinkingFormat: null,
    prices: {
      inputPerToken: 1e-6,
      outputPerToken: 2e-6,
      cacheReadPerToken: null,
      cacheWritePerToken: null,
    },
    source: { limits: "table", prices: "table" },
    ...over,
  };
}

const all = ["anthropic-messages", "openai-chat", "openai-responses"] as const;
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
const subscription = {
  alias: "anthropic" as const,
  connectionId: "conn-oauth",
  template: "anthropic-oauth",
  dialects: ["anthropic-messages"] as const,
  harnesses: ["claude-code"],
};
const entry = (
  p: typeof ibm | typeof cb | typeof subscription,
  upstreamId: string,
  meta?: Partial<ModelMetadata>,
): CatalogEntry => ({
  name: `${p.alias}/${upstreamId}`,
  alias: p.alias,
  connectionId: p.connectionId,
  template: p.template,
  upstreamId,
  dialects: p.dialects,
  ...("harnesses" in p && { harnesses: p.harnesses }),
  metadata: metadata(meta),
});
const providers: CatalogProvider[] = [
  {
    ...ibm,
    displayName: "IBM",
    status: "listed",
    listedAt: null,
    entries: [
      entry(ibm, "aws/claude-opus-4-8", { cacheControl: "anthropic" }),
      entry(ibm, "gpt-5.5"),
    ],
  },
  {
    ...cb,
    displayName: "CB",
    status: "listed",
    listedAt: null,
    entries: [
      entry(cb, "rits/zai-org/glm-5-3", {
        thinkingFormat: "zai",
        vision: false,
      }),
    ],
  },
  {
    ...subscription,
    displayName: "Anthropic",
    status: "listed",
    listedAt: null,
    entries: [entry(subscription, "claude-sonnet-5-5")],
  },
];
const entries = providers.flatMap((p) => p.entries);

beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >;
    seen.push({ path: req.url ?? "", body, headers: req.headers });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "x",
        model: body.model,
        choices: [],
        output: [],
        content: [],
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const addr = upstream.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const envState = (): RuntimeEnvState => ({
    env: {},
    harnesses: [],
    providers: [
      {
        id: "conn-ibm",
        template: "ibm-litellm",
        env: {
          OPENAI_BASE_URL: `${base}/ibm`,
          OPENAI_API_KEY: "platform:conn:conn-ibm",
        },
      },
      {
        id: "conn-cb",
        template: "curve-bender",
        env: {
          OPENAI_BASE_URL: `${base}/cb`,
          OPENAI_API_KEY: "platform:conn:conn-cb",
        },
      },
      {
        id: "conn-oauth",
        template: "anthropic-oauth",
        env: {
          ANTHROPIC_BASE_URL: `${base}/anthropic`,
          CLAUDE_CODE_OAUTH_TOKEN: "platform:conn:conn-oauth",
        },
      },
    ],
  });
  router = composeModelRouter({
    catalog: {
      providers: () => providers,
      forHarness: (harness) => forHarness(entries, harness, HARNESSES[harness]),
    },
    envState,
    harnesses: HARNESSES,
    defaultHarness: "claude-code",
    port: 0,
    log: () => {},
  });
  await router.listen();
});

afterAll(async () => {
  await router.close();
  upstream.close();
});

const get = async (path: string, harness: string) => {
  const r = await fetch(`${router.baseUrl}${path}`, {
    headers: { [HARNESS_HEADER]: harness },
  });
  return { status: r.status, json: (await r.json()) as never };
};
const post = async (
  path: string,
  body: unknown,
  headers: Record<string, string>,
) => {
  const r = await fetch(`${router.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return {
    status: r.status,
    json: (await r.json()) as Record<string, unknown>,
  };
};

describe("catalog endpoints", () => {
  /** TEST_SCENARIO: Claude Code reads `/v1/models` through its gateway
   * discovery: every entry it can run, named under `claude/` and lowercased,
   * with the provider in the description; Pi reads the same list with the
   * per-model metadata it registers providers from. */
  it("serves /v1/models as the harness sees it", async () => {
    const claude = await get("/v1/models?limit=1000", "claude-code");
    const list = claude.json as {
      data: {
        id: string;
        display_name: string;
        description: string;
        metadata: { thinkingFormat: string | null };
      }[];
    };
    expect(list.data.map((m) => m.id)).toEqual([
      "claude/anthropic/claude-sonnet-5-5",
      "claude/ibm/aws/claude-opus-4-8",
      "claude/ibm/gpt-5.5",
      "claude/cb/rits/zai-org/glm-5-3",
    ]);
    expect(list.data[1]).toMatchObject({
      display_name: "aws/claude-opus-4-8",
      description: "IBM · 200k context",
    });
    const pi = await get("/v1/models", "pi");
    const piList = pi.json as typeof list;
    expect(piList.data.map((m) => m.id)).toContain("cb/rits/zai-org/glm-5-3");
    expect(
      piList.data.find((m) => m.id === "cb/rits/zai-org/glm-5-3")?.metadata
        .thinkingFormat,
    ).toBe("zai");
  });

  /** TEST_SCENARIO: Codex drops a catalog with a missing required field, so
   * every field its ModelInfo struct requires is present on each entry with
   * the qualified name as slug, and the catalog stays under Codex's body
   * limit. Only GPT-5-era models take apply_patch as a freeform tool, so
   * Claude and GLM leave the type unset. Codex starts on the first model it
   * is served, so the first provider's newest GPT-5-era model leads. */
  it("serves Codex's catalog with every required ModelInfo field", async () => {
    const r = await get("/codex/models", "codex");
    const { models } = r.json as { models: Record<string, unknown>[] };
    expect(models.map((m) => m.slug)).toEqual([
      "ibm/gpt-5.5",
      "ibm/aws/claude-opus-4-8",
      "cb/rits/zai-org/glm-5-3",
    ]);
    for (const m of models) {
      for (const field of [
        "slug",
        "display_name",
        "supported_reasoning_levels",
        "shell_type",
        "visibility",
        "supported_in_api",
        "priority",
        "support_verbosity",
        "truncation_policy",
        "experimental_supported_tools",
        "context_window",
        "max_context_window",
      ])
        expect(m, field).toHaveProperty(field);
      expect(m.visibility).toBe("list");
      expect(m).toHaveProperty("model_messages.instructions_template");
      expect(m.supported_in_api).toBe(true);
    }
    expect(JSON.stringify(r.json).length).toBeLessThan(models.length * 2048);
    expect(models.map((m) => m.apply_patch_tool_type)).toEqual([
      "freeform",
      null,
      null,
    ]);
    expect(models[1]!.context_window).toBe(200_000);
  });

  /** TEST_SCENARIO: Bob reads a LiteLLM model-info under its `/inference/v1`
   * prefix; only chat-capable providers' models appear, each with the limits
   * and prices Bob uses for its own cost display. The admin API Bob also
   * calls belongs to its own gateway and gets a JSON 404 here. */
  it("serves Bob's model-info and refuses its admin calls", async () => {
    const r = await get("/inference/v1/model/info", "bob");
    const { data } = r.json as {
      data: { model_name: string; model_info: Record<string, unknown> }[];
    };
    expect(data.map((m) => m.model_name)).toEqual([
      "ibm/aws/claude-opus-4-8",
      "ibm/gpt-5.5",
      "cb/rits/zai-org/glm-5-3",
    ]);
    expect(data[0]!.model_info).toMatchObject({
      mode: "chat",
      max_input_tokens: 200_000,
      input_cost_per_token: 1e-6,
      supports_prompt_caching: true,
    });
    const admin = await get("/admin/v1/profile", "bob");
    expect(admin.status).toBe(404);
    const plain = await get("/inference/v1/models", "bob");
    expect((plain.json as { data: unknown[] }).data).toHaveLength(3);
  });
});

describe("provider errors", () => {
  /** TEST_SCENARIO: IBM's proxy refuses DeepSeek on the Responses API with a
   * bare "Authentication parameters missing", and Curve Bender's front end
   * answers an nginx HTML page. Codex shows only the message, so each gains a
   * sentence naming the provider, the model, the API and the harness, with
   * the provider's own text after it; a JSON error keeps its other fields. */
  it("says which provider, model and API refused a call", () => {
    const json = explainUpstreamError({
      status: 403,
      text: JSON.stringify({
        error: { message: "Authentication parameters missing", code: "403" },
      }),
      dialect: "openai-responses",
      harness: "codex",
      provider: "IBM ETE LiteLLM Proxy",
      upstreamId: "rits/deepseek-ai/DeepSeek-V3.2",
    });
    expect(JSON.parse(json)).toEqual({
      error: {
        code: "403",
        message:
          "IBM ETE LiteLLM Proxy refused rits/deepseek-ai/DeepSeek-V3.2 with HTTP 403 on the OpenAI Responses API, which codex uses. The provider said: Authentication parameters missing",
      },
    });
    const html = explainUpstreamError({
      status: 403,
      text: "<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center></body></html>",
      dialect: "anthropic-messages",
      harness: "claude-code",
      provider: "IBM ETE LiteLLM CurveBender",
      upstreamId: "rits/zai-org/glm-5-3",
    });
    expect(JSON.parse(html).error.message).toBe(
      "IBM ETE LiteLLM CurveBender refused rits/zai-org/glm-5-3 with HTTP 403 on the Anthropic Messages API, which claude-code uses. The provider said: 403 Forbidden 403 Forbidden",
    );
  });
});

describe("models offered to a harness", () => {
  /** TEST_SCENARIO: An OpenAI key lists the legacy 8k gpt-4, which Codex's
   * own instructions and tools would overflow on every turn. A model known
   * to hold under 32k tokens is not offered to a harness; one whose window
   * is unknown still is. */
  it("leaves out models too small for a coding harness", () => {
    const entry = (upstreamId: string, contextWindow: number | null) => ({
      name: `openai/${upstreamId}`,
      alias: "openai" as const,
      connectionId: "conn-openai",
      template: "openai",
      upstreamId,
      dialects: ["openai-responses" as const],
      metadata: metadata({ contextWindow }),
    });
    expect(
      forHarness(
        [
          entry("gpt-4", 8_192),
          entry("gpt-5.5", 1_050_000),
          entry("new-model", null),
        ],
        "codex",
        HARNESSES.codex,
      ).map((e) => e.upstreamId),
    ).toEqual(["gpt-5.5", "new-model"]);
  });
});

describe("the Anthropic subscription", () => {
  /** TEST_SCENARIO: An agent holds an Anthropic subscription (OAuth) token.
   * Claude Code's call on it leaves for Anthropic with the Connection's
   * placeholder as a bearer and the OAuth beta flag added to the flags Claude
   * Code sent, since Claude Code, holding the router's placeholder, did not
   * send it; Anthropic accepts the token from Claude Code alone, so Pi's
   * call on the same model is refused by name, and the flag is taken off a
   * call bound for any other provider. */
  it("routes Claude Code's calls on the token and keeps it from other harnesses", async () => {
    seen.length = 0;
    const routed = await post(
      "/v1/messages",
      { model: "claude/anthropic/claude-sonnet-5-5", messages: [] },
      {
        [HARNESS_HEADER]: "claude-code",
        authorization: "Bearer platform:conn:router",
        "anthropic-beta":
          "claude-code-20250219,interleaved-thinking-2025-05-14",
      },
    );
    expect(routed.status).toBe(200);
    expect(seen[0]!.path).toBe("/anthropic/v1/messages");
    expect(seen[0]!.body.model).toBe("claude-sonnet-5-5");
    expect(seen[0]!.headers.authorization).toBe(
      "Bearer platform:conn:conn-oauth",
    );
    expect(seen[0]!.headers["anthropic-beta"]).toBe(
      "claude-code-20250219,interleaved-thinking-2025-05-14,oauth-2025-04-20",
    );

    const refused = await post(
      "/v1/messages",
      { model: "anthropic/claude-sonnet-5-5", messages: [] },
      { [HARNESS_HEADER]: "pi" },
    );
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.json)).toMatch(
      /anthropic-oauth\) works from claude-code only, not from pi/,
    );
    expect(
      (await get("/v1/models", "pi")).json as { data: { id: string }[] },
    ).not.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ id: "anthropic/claude-sonnet-5-5" }),
      ]),
    });

    seen.length = 0;
    await post(
      "/v1/messages",
      { model: "claude/ibm/aws/claude-opus-4-8", messages: [] },
      {
        [HARNESS_HEADER]: "claude-code",
        "anthropic-beta": "oauth-2025-04-20,claude-code-20250219",
      },
    );
    expect(seen[0]!.headers["anthropic-beta"]).toBe("claude-code-20250219");
  });
});

describe("session handles", () => {
  /** TEST_SCENARIO: Each harness names its session differently: Bob by
   * X-Task-Id (and X-Parent-Task-Id on a subagent's call), Codex by its
   * session-id header (session_id before 0.159) with a subagent's own
   * thread-id beside it, Claude Code inside the request metadata's user_id,
   * a JSON object since 2.1 and a `_session_` suffix before. */
  it("reads the session from each harness's own marker", () => {
    const req = (headers: Record<string, string>) => ({ headers }) as never;
    expect(sessionOf(req({ "x-task-id": "s1" }), {})).toEqual({
      sessionId: "s1",
    });
    expect(
      sessionOf(req({ "x-task-id": "child", "x-parent-task-id": "s1" }), {}),
    ).toEqual({ sessionId: "child", parentSessionId: "s1" });
    expect(sessionOf(req({ session_id: "thread-9" }), {})).toEqual({
      sessionId: "thread-9",
    });
    expect(
      sessionOf(req({ "session-id": "thread-9", "thread-id": "thread-9" }), {}),
    ).toEqual({ sessionId: "thread-9" });
    expect(
      sessionOf(req({ "session-id": "thread-9", "thread-id": "child-1" }), {}),
    ).toEqual({ sessionId: "child-1", parentSessionId: "thread-9" });
    expect(
      sessionOf(req({}), {
        metadata: {
          user_id:
            "user_abc_account_11111111-1111-1111-1111-111111111111_session_22222222-2222-2222-2222-222222222222",
        },
      }),
    ).toEqual({ sessionId: "22222222-2222-2222-2222-222222222222" });
    expect(
      sessionOf(req({}), {
        metadata: {
          user_id: JSON.stringify({
            device_id: "d",
            account_uuid: "a",
            session_id: "33333333-3333-3333-3333-333333333333",
          }),
        },
      }),
    ).toEqual({ sessionId: "33333333-3333-3333-3333-333333333333" });
    expect(
      sessionOf(req({}), {
        metadata: {
          user_id: JSON.stringify({
            session_id: "child",
            parent_session_id: "33333333-3333-3333-3333-333333333333",
          }),
        },
      }),
    ).toEqual({
      sessionId: "child",
      parentSessionId: "33333333-3333-3333-3333-333333333333",
    });
    expect(sessionOf(req({}), { metadata: { user_id: "nothing" } })).toBeNull();
  });

  /** TEST_SCENARIO: Bob believes it runs the settings-file model; the runtime
   * set this session to Curve Bender's GLM, so the call leaves for Curve
   * Bender with GLM, and the response names what the runtime picked. The
   * subagent's call (its own task id, the session as parent) asks for the tier
   * alias and runs on the session's subagent model; a session with no choice
   * yet keeps the body's own model. A Codex subagent asking for Codex's
   * built-in gpt-5.6-luna by bare name runs on its session's model, never on
   * whichever provider happens to list that name. */
  it("runs Bob's and Codex's calls on the session's model and its subagents on the subagent model", async () => {
    seen.length = 0;
    router.setSessionModel("bob-s1", {
      model: "cb/rits/zai-org/glm-5-3",
      subagentModel: "ibm/gpt-5.5",
    });
    const main = await post(
      "/inference/v1/chat/completions",
      { model: "ibm/aws/claude-opus-4-8", messages: [] },
      { [HARNESS_HEADER]: "bob", "x-task-id": "bob-s1", "x-mode": "agent" },
    );
    expect(main.status).toBe(200);
    expect(seen[0]).toMatchObject({
      path: "/cb/v1/chat/completions",
      body: { model: "rits/zai-org/glm-5-3" },
    });
    expect(main.json.model).toBe("cb/rits/zai-org/glm-5-3");
    const sub = await post(
      "/inference/v1/chat/completions",
      { model: "premium-ide", messages: [] },
      {
        [HARNESS_HEADER]: "bob",
        "x-task-id": "bob-child",
        "x-parent-task-id": "bob-s1",
      },
    );
    expect(sub.status).toBe(200);
    expect(seen.at(-1)).toMatchObject({
      path: "/ibm/v1/chat/completions",
      body: { model: "gpt-5.5" },
    });
    router.clearSessionModel("bob-s1");

    router.setSessionModel("codex-s1", { model: "cb/rits/zai-org/glm-5-3" });
    const builtin = await post(
      "/v1/responses",
      { model: "gpt-5.6-luna", input: [] },
      {
        [HARNESS_HEADER]: "codex",
        "session-id": "codex-s1",
        "thread-id": "codex-child",
      },
    );
    expect(builtin.status).toBe(200);
    expect(seen.at(-1)).toMatchObject({
      path: "/cb/v1/responses",
      body: { model: "rits/zai-org/glm-5-3" },
    });
    // TEST_SCENARIO: a Codex subagent thread asks for the session's own model by its qualified name; with a subagent model set, the thread goes there and the main thread stays.
    router.setSessionModel("codex-s1", {
      model: "cb/rits/zai-org/glm-5-3",
      subagentModel: "ibm/gpt-5.5",
    });
    await post(
      "/v1/responses",
      { model: "cb/rits/zai-org/glm-5-3", input: [] },
      {
        [HARNESS_HEADER]: "codex",
        "session-id": "codex-s1",
        "thread-id": "codex-child",
      },
    );
    expect(seen.at(-1)).toMatchObject({
      path: "/ibm/v1/responses",
      body: { model: "gpt-5.5" },
    });
    await post(
      "/v1/responses",
      { model: "cb/rits/zai-org/glm-5-3", input: [] },
      {
        [HARNESS_HEADER]: "codex",
        "session-id": "codex-s1",
        "thread-id": "codex-s1",
      },
    );
    expect(seen.at(-1)).toMatchObject({ path: "/cb/v1/responses" });
    router.clearSessionModel("codex-s1");
    // TEST_SCENARIO: a session on the harness's default model has no model of its own, yet its subagent model still applies; main calls keep the body's own model.
    router.setSessionModel("bob-s2", {
      model: null,
      subagentModel: "ibm/gpt-5.5",
    });
    router.setSessionModel("codex-s2", {
      model: null,
      subagentModel: "ibm/gpt-5.5",
    });
    await post(
      "/inference/v1/chat/completions",
      { model: "premium-ide", messages: [] },
      {
        [HARNESS_HEADER]: "bob",
        "x-task-id": "bob-child-2",
        "x-parent-task-id": "bob-s2",
      },
    );
    expect(seen.at(-1)).toMatchObject({
      path: "/ibm/v1/chat/completions",
      body: { model: "gpt-5.5" },
    });
    await post(
      "/inference/v1/chat/completions",
      { model: "cb/rits/zai-org/glm-5-3", messages: [] },
      { [HARNESS_HEADER]: "bob", "x-task-id": "bob-s2" },
    );
    expect(seen.at(-1)).toMatchObject({ path: "/cb/v1/chat/completions" });
    await post(
      "/v1/responses",
      { model: "cb/rits/zai-org/glm-5-3", input: [] },
      {
        [HARNESS_HEADER]: "codex",
        "session-id": "codex-s2",
        "thread-id": "codex-child-2",
      },
    );
    expect(seen.at(-1)).toMatchObject({
      path: "/ibm/v1/responses",
      body: { model: "gpt-5.5" },
    });
    router.clearSessionModel("bob-s2");
    router.clearSessionModel("codex-s2");
    const unset = await post(
      "/inference/v1/chat/completions",
      { model: "ibm/gpt-5.5", messages: [] },
      { [HARNESS_HEADER]: "bob", "x-task-id": "bob-s1" },
    );
    expect(unset.status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ path: "/ibm/v1/chat/completions" });
  });
});

describe("replay rules", () => {
  const history = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "fake", signature: "x".repeat(32) },
        { type: "text", text: "a" },
      ],
    },
    { role: "user", content: "more" },
    {
      role: "assistant",
      content: [
        { type: "redacted_thinking", data: "zz" },
        { type: "thinking", thinking: "  " },
        { type: "tool_use", id: "t", name: "f", input: {} },
      ],
    },
  ];
  /** TEST_SCENARIO: A Messages body carrying a GLM-made thinking block in a
   * prior turn reaches a Claude model with that block as text; the last
   * assistant message keeps its blocks; a GLM target gets the body as is. */
  it("turns prior-turn thinking into text for a Claude target only", () => {
    const out = applyReplayRules(
      { messages: history },
      {
        dialect: "anthropic-messages",
        alias: "ibm",
        upstreamId: "aws/claude-opus-4-8",
      },
    );
    const messages = out.messages as { content: unknown }[];
    expect(messages[1]!.content).toEqual([
      { type: "text", text: "<thinking>fake</thinking>" },
      { type: "text", text: "a" },
    ]);
    expect(messages[3]!.content).toEqual(history[3]!.content);
    const glm = applyReplayRules(
      { messages: history },
      {
        dialect: "anthropic-messages",
        alias: "cb",
        upstreamId: "rits/zai-org/glm-5-3",
      },
    );
    expect(glm.messages).toBe(history);
    const noAssistant = applyReplayRules(
      { messages: [{ role: "user", content: "x" }] },
      { dialect: "anthropic-messages", alias: "ibm", upstreamId: "claude-x" },
    );
    expect(noAssistant.messages).toHaveLength(1);
  });

  /** TEST_SCENARIO: A Responses body with a Curve Bender bridge reasoning
   * item (non-empty content) and an OpenAI encrypted item reaches OpenAI with
   * only the encrypted one, and any other target with no reasoning item. */
  it("drops the reasoning items each Responses target refuses", () => {
    const input = [
      { type: "message", role: "user", content: "x" },
      {
        type: "reasoning",
        id: "r1",
        content: [{ type: "reasoning_text", text: "glm" }],
      },
      { type: "reasoning", id: "r2", encrypted_content: "abc", content: [] },
      { type: "function_call", name: "f" },
    ];
    const openai = applyReplayRules(
      { input },
      { dialect: "openai-responses", alias: "openai", upstreamId: "gpt-5.5" },
    ).input as { id?: string }[];
    expect(openai.map((i) => i.id ?? i)).toEqual([input[0], "r2", input[3]]);
    const ibm = applyReplayRules(
      { input, tools: [{ type: "function", name: "f" }] },
      { dialect: "openai-responses", alias: "ibm", upstreamId: "gpt-5.5" },
    ).input as { type: string }[];
    expect(ibm.map((i) => i.type)).toEqual(["message", "function_call"]);
    const chat = applyReplayRules(
      { messages: history },
      { dialect: "openai-chat", alias: "ibm", upstreamId: "gpt-5.5" },
    );
    expect(chat.messages).toBe(history);
  });

  /** TEST_SCENARIO: Codex on IBM's Claude, which LiteLLM hands to Bedrock.
   * Every call carries Codex's client_metadata, which Bedrock refuses once
   * the call streams or reasons, so it is dropped for any provider but
   * OpenAI. A compaction call carries the turn's earlier tool calls and
   * results but no tools, which Bedrock refuses ("The toolConfig field must
   * be defined"), so they become text; with tools offered they stay, and
   * OpenAI itself gets both untouched. */
  it("keeps Codex's calls acceptable to Bedrock", () => {
    const input = [
      { type: "message", role: "user", content: "x" },
      {
        type: "function_call",
        call_id: "c1",
        name: "shell",
        arguments: '{"command":["ls"]}',
      },
      { type: "function_call_output", call_id: "c1", output: "a.txt" },
    ];
    const claude = {
      dialect: "openai-responses" as const,
      alias: "ibm" as const,
      upstreamId: "aws/claude-opus-5-5",
    };
    const compaction = applyReplayRules(
      { input, stream: true, client_metadata: { a: "b" } },
      claude,
    );
    expect(compaction).not.toHaveProperty("client_metadata");
    expect(compaction.input).toEqual([
      input[0],
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: '[tool call shell: {"command":["ls"]}]',
          },
        ],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "[tool result c1: a.txt]" }],
      },
    ]);
    const turn = applyReplayRules(
      { input, tools: [{ type: "function", name: "shell" }] },
      claude,
    );
    expect(turn.input).toBe(input);
    const openai = { input, client_metadata: { a: "b" } };
    expect(
      applyReplayRules(openai, {
        dialect: "openai-responses",
        alias: "openai",
        upstreamId: "gpt-5.5",
      }),
    ).toBe(openai);
  });

  /** TEST_SCENARIO: Codex sends its session's reasoning effort on every turn;
   * OpenAI refuses it on gpt-4.1, which the catalog knows does not reason, so
   * the parameter is dropped there and kept where reasoning is known or
   * unknown. */
  it("drops reasoning parameters for a model that does not reason", () => {
    const body = { model: "gpt-4.1", reasoning: { effort: "medium" } };
    expect(
      dropUnsupportedReasoning(body, {
        dialect: "openai-responses",
        reasoning: false,
      }),
    ).toEqual({ model: "gpt-4.1" });
    expect(
      dropUnsupportedReasoning(body, {
        dialect: "openai-responses",
        reasoning: null,
      }),
    ).toBe(body);
    expect(
      dropUnsupportedReasoning(
        { reasoning_effort: "low" },
        { dialect: "openai-chat", reasoning: false },
      ),
    ).toEqual({});
  });

  /** TEST_SCENARIO: Claude Code sends a thinking display Bedrock behind
   * IBM's proxy refuses; it is dropped there, kept for Anthropic's own API,
   * and a value Bedrock knows stays. */
  it("drops a thinking display Bedrock refuses", () => {
    const ibm = {
      dialect: "anthropic-messages" as const,
      alias: "ibm" as const,
      upstreamId: "aws/claude-opus-4-5",
    };
    const full = {
      thinking: { type: "enabled", budget_tokens: 1024, display: "full" },
    };
    expect(applyReplayRules(full, ibm).thinking).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
    expect(applyReplayRules(full, { ...ibm, alias: "anthropic" })).toBe(full);
    const ok = { thinking: { type: "enabled", display: "summarized" } };
    expect(applyReplayRules(ok, ibm)).toBe(ok);
  });

  /** TEST_SCENARIO: Bob asks every model for 64000 output tokens. OpenAI
   * refuses that on gpt-4o (16384 at most) and refuses max_tokens itself on
   * its reasoning models, so a chat call to OpenAI carries the budget as
   * max_completion_tokens, cut to the model's known limit; another provider
   * keeps max_tokens, cut the same way, and an unknown limit cuts nothing.
   * A cut Messages budget pulls the thinking budget under it, and drops
   * thinking when too little is left for it. */
  it("fits the output budget to the model", () => {
    expect(
      fitOutputBudget(
        { max_tokens: 64000 },
        { dialect: "openai-chat", alias: "openai", maxOutputTokens: 16384 },
      ),
    ).toEqual({ max_completion_tokens: 16384 });
    expect(
      fitOutputBudget(
        { max_tokens: 64000 },
        { dialect: "openai-chat", alias: "openai", maxOutputTokens: 128000 },
      ),
    ).toEqual({ max_completion_tokens: 64000 });
    expect(
      fitOutputBudget(
        { max_tokens: 64000 },
        { dialect: "openai-chat", alias: "ibm", maxOutputTokens: 32000 },
      ),
    ).toEqual({ max_tokens: 32000 });
    const unknown = { max_output_tokens: 64000 };
    expect(
      fitOutputBudget(unknown, {
        dialect: "openai-responses",
        alias: "cb",
        maxOutputTokens: null,
      }),
    ).toBe(unknown);
    const thinking = { type: "enabled", budget_tokens: 16000 };
    expect(
      fitOutputBudget(
        { max_tokens: 64000, thinking },
        { dialect: "anthropic-messages", alias: "ibm", maxOutputTokens: 8192 },
      ),
    ).toEqual({
      max_tokens: 8192,
      thinking: { type: "enabled", budget_tokens: 8191 },
    });
    expect(
      fitOutputBudget(
        { max_tokens: 64000, thinking },
        { dialect: "anthropic-messages", alias: "ibm", maxOutputTokens: 1000 },
      ),
    ).toEqual({ max_tokens: 1000 });
  });

  /** TEST_SCENARIO: A streamed chat completion without stream_options gets
   * include_usage so the final chunk carries the usage the spend records
   * need; a body that sets its own stream_options is left alone. */
  it("asks for the usage chunk on streamed chat completions", () => {
    expect(ensureStreamUsage({ stream: true }, "openai-chat")).toEqual({
      stream: true,
      stream_options: { include_usage: true },
    });
    const own = { stream: true, stream_options: { include_usage: false } };
    expect(ensureStreamUsage(own, "openai-chat")).toBe(own);
    expect(ensureStreamUsage({ stream: true }, "openai-responses")).toEqual({
      stream: true,
    });
    expect(ensureStreamUsage({ stream: false }, "openai-chat")).toEqual({
      stream: false,
    });
  });

  /** TEST_SCENARIO: Claude Code confirms a picked model with a one-token
   * Messages call, which IBM's reasoning GPT models refuse ("max_tokens or
   * model output limit was reached"), so the pick failed. A Messages call to
   * a model that is not Claude gets at least 64 output tokens; a Claude
   * target, a larger budget and the other dialects are left alone. */
  it("gives a non-Claude Messages call room to answer", () => {
    const gpt = {
      dialect: "anthropic-messages" as const,
      upstreamId: "azure/gpt-5.5",
    };
    expect(floorOutputBudget({ max_tokens: 1 }, gpt)).toEqual({
      max_tokens: 64,
    });
    const big = { max_tokens: 32_000 };
    expect(floorOutputBudget(big, gpt)).toBe(big);
    const one = { max_tokens: 1 };
    expect(
      floorOutputBudget(one, {
        dialect: "anthropic-messages",
        upstreamId: "aws/claude-sonnet-5-5",
      }),
    ).toBe(one);
    expect(
      floorOutputBudget(one, {
        dialect: "openai-chat",
        upstreamId: "azure/gpt-5.5",
      }),
    ).toBe(one);
  });

  /** TEST_SCENARIO: Through the composed router, a streamed chat call to
   * Curve Bender leaves with include_usage set. */
  it("applies the rules on the wire", async () => {
    seen.length = 0;
    await post(
      "/v1/chat/completions",
      { model: "cb/rits/zai-org/glm-5-3", stream: true, messages: [] },
      { [HARNESS_HEADER]: "pi" },
    );
    expect(seen[0]!.body.stream_options).toEqual({ include_usage: true });
  });
});
