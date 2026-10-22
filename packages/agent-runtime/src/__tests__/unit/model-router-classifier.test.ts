/**
 * TEST_OVERVIEW: The Model Router sends Claude Code's auto-mode classifier
 * call to the session provider's preferred classifier: the process holds the
 * default provider's (Anthropic's) Sonnet, a session moved to CurveBender
 * sends that name, and the call leaves for CurveBender's Nemotron. A
 * main-conversation turn names the same model but is not the classifier's
 * call, so it stays where it asked.
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
} from "../../modules/model-router/index.js";

const CB_WORK = "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017";
const CB_CLASSIFIER = "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4";
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

const provider = (
  alias: "anthropic" | "cb",
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
        ANTHROPIC_API_KEY: "platform:conn:conn-ant",
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
    sessionModelOf: (id) => (id === "s-cb" ? { model: `cb/${CB_WORK}` } : null),
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

const call = (headers: Record<string, string>) =>
  fetch(`${router.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ model: PROCESS_CLASSIFIER, messages: [] }),
  });

describe("the classifier's call", () => {
  /** TEST_SCENARIO: CurveBender lists the platform's preferred classifier, so a side call carrying Anthropic's Sonnet leaves for CurveBender's Nemotron; the same model named by a main-conversation turn stays on Anthropic, since only the classifier's call is moved. */
  it("follows the session, and only for the classifier's own call", async () => {
    sent.length = 0;
    expect(
      (
        await call({
          "x-test-session": "s-cb",
          "x-claude-code-request-class": "auxiliary",
        })
      ).status,
    ).toBe(200);
    expect(sent[0]).toEqual({
      url: "http://upstream.invalid/cb/v1/messages",
      model: CB_CLASSIFIER,
    });
    expect(
      (
        await call({
          "x-test-session": "s-cb",
          "x-claude-code-request-class": "main",
        })
      ).status,
    ).toBe(200);
    expect(sent[1]).toEqual({
      url: "http://upstream.invalid/ant/v1/messages",
      model: "claude-sonnet-5-5",
    });
  });
});
