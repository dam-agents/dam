/**
 * TEST_OVERVIEW: The Model Router sends Claude Code's auto-mode classifier
 * call to the session provider's preferred classifier: the process holds the
 * default provider's (Anthropic's) Sonnet, a session moved to CurveBender
 * sends that name, and the call leaves for CurveBender's Nemotron. Only a call
 * Claude Code classes as auxiliary and stamps with no subagent id is the
 * classifier's; a subagent's or a workflow agent's call naming the same model
 * is work and keeps the tier rule. A session in server-side auto mode keeps
 * the call, and a non-Claude subagent model takes it out of that mode.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
} from "../../modules/model-catalog/index.js";
import type { RuntimeEnvState } from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import {
  createModelRouter,
  type ModelRouter,
  type SessionModelChoice,
} from "../../modules/model-router/index.js";

const CB_WORK = "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017";
const CB_CLASSIFIER = "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4";
const IBM_CLASSIFIER = "aws/nvidia/NVIDIA-Nemotron-3-Ultra-550B";
const PROCESS_CLASSIFIER = "claude/anthropic/claude-sonnet-5-5";

const sent: { url: string; model: unknown }[] = [];
let router: ModelRouter;

const metadata = {
  contextWindow: 200_000,
  maxOutputTokens: null,
  reasoning: null,
  vision: null,
  cacheControl: null,
  thinkingFormat: null,
  prices: null,
  source: { limits: "none", prices: "none" },
} as const;

type FixtureAlias = "anthropic" | "cb" | "ibm";

const provider = (
  alias: FixtureAlias,
  template: string,
  ids: string[],
): CatalogProvider => ({
  connectionId: `conn-${alias}`,
  alias,
  template,
  displayName: alias,
  dialects: ["anthropic-messages"],
  status: "listed",
  listedAt: null,
  entries: ids.map((upstreamId): CatalogEntry => ({
    name: `${alias}/${upstreamId}`,
    alias,
    connectionId: `conn-${alias}`,
    template,
    upstreamId,
    dialects: ["anthropic-messages"],
    metadata,
  })),
});

const envState: RuntimeEnvState = {
  env: {},
  harnesses: [],
  providers: [
    {
      id: "conn-anthropic",
      template: "anthropic",
      env: {
        ANTHROPIC_BASE_URL: "http://upstream.invalid/ant",
        ANTHROPIC_API_KEY: "platform:conn:conn-anthropic",
      },
    },
    {
      id: "conn-cb",
      template: "curve-bender",
      env: {
        ANTHROPIC_BASE_URL: "http://upstream.invalid/cb",
        ANTHROPIC_AUTH_TOKEN: "sk-platform:conn:conn-cb",
      },
    },
    {
      id: "conn-ibm",
      template: "ibm-litellm",
      env: {
        ANTHROPIC_BASE_URL: "http://upstream.invalid/ibm",
        ANTHROPIC_API_KEY: "platform:conn:conn-ibm",
      },
    },
  ],
};

beforeAll(async () => {
  router = createModelRouter({
    catalog: {
      providers: () => [
        provider("anthropic", "anthropic", [
          "claude-sonnet-5-5",
          "claude-opus-5-5",
        ]),
        provider("cb", "curve-bender", [CB_WORK, CB_CLASSIFIER]),
        provider("ibm", "ibm-litellm", [
          "aws/claude-opus-5-5",
          "aws/claude-sonnet-5-5",
          "gpt-5.5",
          IBM_CLASSIFIER,
        ]),
      ],
    },
    envState: () => envState,
    harnesses: {
      "claude-code": {
        dialects: ["anthropic-messages"],
        namePrefix: "claude/",
        lowercaseNames: true,
        claudeTiers: true,
        classifierModelEnv: "CLAUDE_CODE_AUTO_MODE_MODEL",
      },
    },
    defaultHarness: "claude-code",
    sessionOf: (req) => {
      const id = req.headers["x-test-session"] as string | undefined;
      return id ? { sessionId: id } : null;
    },
    sessionModelOf: (id) => sessions[id] ?? null,
    fetchImpl: async (_url, init) => {
      sent.push({
        url: String(_url),
        model: (JSON.parse(String(init?.body)) as Record<string, unknown>)
          .model,
      });
      return new Response(
        JSON.stringify({ id: "m", type: "message", model: "", content: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    port: 0,
    log: () => {},
  });
  await router.listen();
});

afterAll(async () => {
  await router.close();
});

const call = (session: string, headers: Record<string, string> = {}) =>
  fetch(`${router.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-session": session,
      ...headers,
    },
    body: JSON.stringify({ model: PROCESS_CLASSIFIER, messages: [] }),
  });

const sessions: Record<string, SessionModelChoice> = {
  "s-cb": { model: `cb/${CB_WORK}` },
  "s-ibm": { model: "ibm/aws/claude-opus-5-5" },
  "s-ibm-gpt": {
    model: "ibm/aws/claude-opus-5-5",
    subagentModel: "ibm/gpt-5.5",
  },
};
const auxiliary = { "x-claude-code-request-class": "auxiliary" };
const subagent = {
  "x-claude-code-request-class": "subagent",
  "x-claude-code-agent-id": "agent-1",
};

describe("the classifier's call", () => {
  /** TEST_SCENARIO: CurveBender lists the platform's preferred classifier, so a side call carrying Anthropic's Sonnet leaves for CurveBender's Nemotron; the same model named by a main-conversation turn stays on Anthropic, since only the classifier's call is moved. An auxiliary title naming that model, which only happens when the provider's Haiku slot falls back to it, is indistinguishable from the classifier and follows the same rule. */
  it("follows the session for the classifier's own call", async () => {
    sent.length = 0;
    expect((await call("s-cb", auxiliary)).status).toBe(200);
    expect(sent[0]).toEqual({
      url: "http://upstream.invalid/cb/v1/messages",
      model: CB_CLASSIFIER,
    });
    expect(
      (await call("s-cb", { "x-claude-code-request-class": "main" })).status,
    ).toBe(200);
    expect(sent[1]).toEqual({
      url: "http://upstream.invalid/ant/v1/messages",
      model: "claude-sonnet-5-5",
    });
  });

  /** TEST_SCENARIO: A subagent's work can name the very model the classifier names, because the process's Sonnet slot holds it too. The class keeps it work: on CurveBender it runs on the session's own DeepSeek, and on IBM on IBM's Sonnet, as the tier rule sends it; an auxiliary call stamped with an agent id is a subagent's compaction and goes the same way. */
  it("leaves a subagent's work on the tier rule", async () => {
    sent.length = 0;
    await call("s-cb", subagent);
    await call("s-ibm", subagent);
    await call("s-cb", { ...auxiliary, "x-claude-code-agent-id": "agent-2" });
    expect(sent).toEqual([
      { url: "http://upstream.invalid/cb/v1/messages", model: CB_WORK },
      {
        url: "http://upstream.invalid/ibm/v1/messages",
        model: "aws/claude-sonnet-5-5",
      },
      { url: "http://upstream.invalid/cb/v1/messages", model: CB_WORK },
    ]);
  });

  /** TEST_SCENARIO: A Claude session on IBM answers the auto-mode check itself, so its classifier keeps the name the harness sent; the process env turns that mode off when the session sets a non-Claude subagent model, and then the classifier goes to IBM's preferred classifier like any other session on IBM. */
  it("keeps a server-side session's classifier, and moves one with a GPT subagent model", async () => {
    sent.length = 0;
    await call("s-ibm", auxiliary);
    await call("s-ibm-gpt", auxiliary);
    expect(sent).toEqual([
      {
        url: "http://upstream.invalid/ant/v1/messages",
        model: "claude-sonnet-5-5",
      },
      { url: "http://upstream.invalid/ibm/v1/messages", model: IBM_CLASSIFIER },
    ]);
  });
});
