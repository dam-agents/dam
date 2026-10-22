/**
 * TEST_OVERVIEW: The env a harness process gets to run on the Model Router:
 * the router's address for every harness, and for Claude Code the tier
 * slots filled from the agent's default provider (newest model per tier,
 * with the old gateway's fallbacks) as catalog names, the auto-mode
 * classifier on the platform's preferred classifier for that provider, and
 * the smallest context window the harness may run on as the process-wide cap.
 */
import { describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
} from "../../modules/model-catalog/index.js";
import {
  routerEnvFor,
  servedModels,
  tierModels,
} from "../../modules/model-router/index.js";
import type { ModelRouterBinding } from "../../modules/runtime-channel/manifest.js";

const entry = (
  p: Pick<CatalogProvider, "alias" | "connectionId" | "template" | "dialects">,
  upstreamId: string,
  contextWindow: number | null,
): CatalogEntry => ({
  name: `${p.alias}/${upstreamId}`,
  alias: p.alias,
  connectionId: p.connectionId,
  template: p.template,
  upstreamId,
  dialects: p.dialects,
  metadata: {
    contextWindow,
    maxOutputTokens: null,
    reasoning: null,
    vision: null,
    cacheControl: null,
    thinkingFormat: null,
    prices: null,
    source: { limits: "none", prices: "none" },
  },
});
const all = ["anthropic-messages", "openai-chat", "openai-responses"] as const;
const cb = {
  alias: "cb" as const,
  connectionId: "c",
  template: "curve-bender",
  dialects: all,
};
const ibm = {
  alias: "ibm" as const,
  connectionId: "i",
  template: "ibm-litellm",
  dialects: all,
};
const openai = {
  alias: "openai" as const,
  connectionId: "o",
  template: "openai",
  dialects: ["openai-chat", "openai-responses"] as const,
};
const anthropic = {
  alias: "anthropic" as const,
  connectionId: "a",
  template: "anthropic",
  dialects: all.filter((d) => d === "anthropic-messages"),
};
const subscription = {
  alias: "anthropic" as const,
  connectionId: "a",
  template: "anthropic-oauth",
  dialects: all.filter((d) => d === "anthropic-messages"),
  harnesses: ["claude-code"],
};
const provider = (
  p:
    | typeof cb
    | typeof ibm
    | typeof openai
    | typeof anthropic
    | typeof subscription,
  entries: CatalogEntry[],
): CatalogProvider => ({
  ...p,
  displayName: p.alias,
  status: "listed",
  listedAt: null,
  entries,
});
const claude: ModelRouterBinding = {
  dialects: ["anthropic-messages"],
  namePrefix: "claude/",
  lowercaseNames: true,
  claudeTiers: true,
  classifierModelEnv: "CLAUDE_CODE_AUTO_MODE_MODEL",
};
const CB_WORK = "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017";
const CB_CLASSIFIER = "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4";

describe("tierModels", () => {
  /** TEST_SCENARIO: Each tier takes the newest model carrying its word; a
   * missing tier falls back to opus, then sonnet, then haiku, then the newest
   * model of all, so a provider with no Claude model still fills every slot. */
  it("fills every slot, newest first, with the gateway's fallbacks", () => {
    expect(
      tierModels([
        "aws/claude-opus-4-8",
        "aws/claude-opus-5-5",
        "aws/claude-sonnet-4-6",
        "gpt-5.5",
      ]),
    ).toEqual({
      fable: "aws/claude-opus-5-5",
      opus: "aws/claude-opus-5-5",
      sonnet: "aws/claude-sonnet-4-6",
      haiku: "aws/claude-sonnet-4-6",
    });
    expect(
      tierModels([
        "rits/zai-org/glm-5-3",
        "rits/nvidia/NVIDIA-Nemotron-3-Ultra",
      ]),
    ).toEqual({
      fable: "rits/zai-org/glm-5-3",
      opus: "rits/zai-org/glm-5-3",
      sonnet: "rits/zai-org/glm-5-3",
      haiku: "rits/zai-org/glm-5-3",
    });
    expect(tierModels([])).toBeNull();
  });
});

describe("routerEnvFor", () => {
  /** TEST_SCENARIO: An agent holds only an Anthropic subscription token,
   * which Anthropic accepts from Claude Code alone. Claude Code is served by
   * it, with its tiers from the subscription's list; Pi, which speaks the
   * same Messages API, is not served and gets no mark. */
  it("offers a subscription token to Claude Code alone", () => {
    const providers = [
      provider(subscription, [
        entry(subscription, "claude-opus-5-5", 1_000_000),
        entry(subscription, "claude-haiku-4-5", 200_000),
      ]),
    ];
    const claudeEnv = routerEnvFor({
      harness: "claude-code",
      binding: claude,
      providers,
      port: 1,
    });
    expect(claudeEnv.PLATFORM_MODEL_ROUTER_SERVES).toBe("1");
    expect(claudeEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(
      "claude/anthropic/claude-opus-5-5",
    );
    const piEnv = routerEnvFor({
      harness: "pi",
      binding: { dialects: [...all] },
      providers,
      port: 1,
    });
    expect(piEnv.PLATFORM_MODEL_ROUTER_SERVES).toBeUndefined();
  });

  /** TEST_SCENARIO: Copilot refuses to start without a model, so the variable its manifest names gets the first model of the first provider that serves its Chat Completions API; the Anthropic key serves no such API and is passed over, and with no provider the variable stays unset. */
  it("names the default model in the variable a harness needs at start", () => {
    const copilot: ModelRouterBinding = {
      dialects: ["openai-chat"],
      defaultModelEnv: ["COPILOT_MODEL"],
    };
    const env = routerEnvFor({
      harness: "copilot",
      binding: copilot,
      providers: [
        provider(anthropic, [entry(anthropic, "claude-opus-5-5", 1_000_000)]),
        provider(openai, [entry(openai, "gpt-5.5", 1_000_000)]),
      ],
      port: 1,
    });
    expect(env.COPILOT_MODEL).toBe("openai/gpt-5.5");
    expect(
      routerEnvFor({
        harness: "copilot",
        binding: copilot,
        providers: [],
        port: 1,
      }).COPILOT_MODEL,
    ).toBeUndefined();
  });

  /** TEST_SCENARIO: An agent holds IBM and an Anthropic key. Anthropic is
   * Claude Code's own provider, so its tiers come from Anthropic, not from
   * IBM, which comes first in the shared order. */
  it("fills Claude Code's tiers from its own provider when held", () => {
    const env = routerEnvFor({
      harness: "claude-code",
      binding: claude,
      providers: [
        provider(ibm, [entry(ibm, "aws/claude-opus-4-8", 200_000)]),
        provider(anthropic, [
          entry(anthropic, "claude-opus-5-5", 1_000_000),
          entry(anthropic, "claude-haiku-4-5", 200_000),
        ]),
      ],
      port: 1,
    });
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(
      "claude/anthropic/claude-opus-5-5",
    );
  });

  /** TEST_SCENARIO: IBM is the default provider in alias order among the
   * providers that serve Claude Code, so the tier slots are IBM's models as
   * Claude Code names them, and the env window is the widest one across IBM's
   * and Curve Bender's models, since Claude Code applies it to an id it does
   * not recognise and would otherwise compact a wide model far below its
   * ceiling; the OpenAI key serves no Messages API and takes no part. A harness without claudeTiers gets the address only, plus
   * the router's placeholder in the key variable its client insists on
   * (Codex refuses to list models without OPENAI_API_KEY).
   * Every harness a granted provider serves is marked as served, even before
   * that provider has listed, so Claude Code does not start on Anthropic's
   * own endpoint while the first listing is still out; with nothing granted
   * there is no mark. A model the harness is never offered (an embedding
   * model, a window under the coding floor) neither caps the window nor
   * fills a tier slot. */
  it("fills Claude Code's tiers from the default provider and takes the widest window", () => {
    const providers = [
      provider(openai, [entry(openai, "gpt-5.5", 1_000_000)]),
      provider(cb, [
        entry(cb, "rits/zai-org/glm-5-3", 128_000),
        entry(cb, "rits/tiny-chat", 16_000),
      ]),
      provider(ibm, [
        entry(ibm, "aws/claude-opus-4-8", 200_000),
        entry(ibm, "aws/claude-sonnet-4-6", 200_000),
        entry(ibm, "gpt-5.5", null),
        entry(ibm, "text-embedding-3-large", 8_191),
      ]),
    ];
    expect(tierModels(["text-embedding-3-large", "rerank-english-v3"])).toBe(
      null,
    );
    expect(tierModels(["text-embedding-3-large", "gpt-5.5"])?.opus).toBe(
      "gpt-5.5",
    );
    expect(
      routerEnvFor({
        harness: "claude-code",
        binding: claude,
        providers,
        port: 24180,
      }),
    ).toEqual({
      PLATFORM_MODEL_ROUTER_URL: "http://127.0.0.1:24180",
      PLATFORM_MODEL_ROUTER_PORT: "24180",
      PLATFORM_MODEL_ROUTER_SERVES: "1",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "claude/ibm/aws/claude-opus-4-8",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude/ibm/aws/claude-opus-4-8",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude/ibm/aws/claude-sonnet-4-6",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude/ibm/aws/claude-sonnet-4-6",
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "200000",
    });
    expect(
      routerEnvFor({
        harness: "codex",
        binding: {
          dialects: ["openai-responses"],
          credentialEnv: ["OPENAI_API_KEY"],
        },
        providers,
        port: 1,
      }),
    ).toEqual({
      PLATFORM_MODEL_ROUTER_URL: "http://127.0.0.1:1",
      PLATFORM_MODEL_ROUTER_PORT: "1",
      PLATFORM_MODEL_ROUTER_SERVES: "1",
      OPENAI_API_KEY: "platform:conn:router",
    });
    const none = routerEnvFor({
      harness: "claude-code",
      binding: claude,
      providers: [],
      port: 1,
    });
    expect(none).not.toHaveProperty("ANTHROPIC_DEFAULT_OPUS_MODEL");
    expect(none).not.toHaveProperty("PLATFORM_MODEL_ROUTER_SERVES");
    expect(
      routerEnvFor({
        harness: "claude-code",
        binding: claude,
        providers: [provider(ibm, [])],
        port: 1,
      }),
    ).toMatchObject({ PLATFORM_MODEL_ROUTER_SERVES: "1" });
    expect(
      routerEnvFor({
        harness: "bob",
        binding: { dialects: ["openai-chat"], bobGateway: true },
        providers,
        port: 24180,
      }),
    ).toEqual({
      PLATFORM_MODEL_ROUTER_URL: "http://127.0.0.1:24180",
      PLATFORM_MODEL_ROUTER_PORT: "24180",
      PLATFORM_MODEL_ROUTER_SERVES: "1",
      BOB_GATEWAY_URL: "http://127.0.0.1:24180",
      BOBSHELL_API_KEY: "platform:conn:router",
      PLATFORM_BOB_DEFAULT_MODEL: "ibm/aws/claude-opus-4-8",
    });
  });
});

describe("the auto-mode classifier env", () => {
  const cbListing = (ids: string[]) =>
    provider(
      cb,
      ids.map((id) => entry(cb, id, 1_048_576)),
    );

  /** TEST_SCENARIO: CurveBender's ids carry no tier word, so its slots say nothing about which model classifies: the knob names the platform's preferred classifier on the default provider, by its qualified name so the router resolves it without guessing, while every slot stays the work model the person's session runs on. */
  it("names the preferred classifier, leaving the slots on the work model", () => {
    const env = routerEnvFor({
      harness: "claude-code",
      binding: claude,
      providers: [cbListing(["rits/zai-org/glm-5-4", CB_CLASSIFIER, CB_WORK])],
      port: 1,
    });
    expect(env.CLAUDE_CODE_AUTO_MODE_MODEL).toBe(
      `claude/cb/${CB_CLASSIFIER.toLowerCase()}`,
    );
    for (const tier of ["FABLE", "OPUS", "SONNET", "HAIKU"])
      expect(env[`ANTHROPIC_DEFAULT_${tier}_MODEL`]).toBe(
        `claude/cb/${CB_WORK.toLowerCase()}`,
      );
  });

  /** TEST_SCENARIO: The knob and the Sonnet slot are independent: a provider whose listing changes which model fills the slots leaves the classifier where the list puts it, and a Sonnet slot the person's own provider fills says nothing about the classifier. */
  it("does not follow the Sonnet slot", () => {
    const [older, newer] = [
      cbListing([CB_WORK, CB_CLASSIFIER]),
      cbListing([CB_WORK, "rits/zai-org/glm-5-4", CB_CLASSIFIER]),
    ];
    const envOf = (p: CatalogProvider) =>
      routerEnvFor({
        harness: "claude-code",
        binding: claude,
        providers: [p],
        port: 1,
      });
    expect(envOf(older).CLAUDE_CODE_AUTO_MODE_MODEL).toBe(
      envOf(newer).CLAUDE_CODE_AUTO_MODE_MODEL,
    );
    const anthropicListing = provider(anthropic, [
      entry(anthropic, "claude-opus-5-5", 1_000_000),
      entry(anthropic, "claude-sonnet-5-5", 1_000_000),
    ]);
    const env = envOf(anthropicListing);
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
      "claude/anthropic/claude-sonnet-5-5",
    );
    expect(env.CLAUDE_CODE_AUTO_MODE_MODEL).toBe(
      "claude/anthropic/claude-sonnet-5-5",
    );
  });

  /** TEST_SCENARIO: A provider that lists none of the list's classifier models, and a harness whose manifest names no classifier variable, get no key at all, so Claude Code falls back to its own order instead of being pointed at a model nobody chose. */
  it("stays out of the way when nothing names a classifier", () => {
    expect(
      routerEnvFor({
        harness: "claude-code",
        binding: claude,
        providers: [
          cbListing([CB_WORK, "rits/nvidia/NVIDIA-Nemotron-4-Ultra"]),
        ],
        port: 1,
      }),
    ).not.toHaveProperty("CLAUDE_CODE_AUTO_MODE_MODEL");
    expect(
      routerEnvFor({
        harness: "claude-code",
        binding: { ...claude, classifierModelEnv: undefined },
        providers: [cbListing([CB_WORK, CB_CLASSIFIER])],
        port: 1,
      }),
    ).not.toHaveProperty("CLAUDE_CODE_AUTO_MODE_MODEL");
    expect(
      routerEnvFor({
        harness: "claude-code",
        binding: claude,
        providers: [],
        port: 1,
      }),
    ).not.toHaveProperty("CLAUDE_CODE_AUTO_MODE_MODEL");
  });
});

describe("servedModels", () => {
  /** TEST_SCENARIO: Every model the harness may run on appears once, named as the router resolves it, with the window its Connection declares or null, so the harness's settings file can carry one window per model; a model the harness is never offered and a provider that does not serve it take no part. */
  it("lists each served model with its window, by its router name", () => {
    const providers = [
      provider(cb, [
        entry(cb, "rits/deepseek-ai/deepseek-v4.1-flash-1017", 1_048_576),
      ]),
      provider(ibm, [
        entry(ibm, "aws/claude-opus-5-5", 200_000),
        entry(ibm, "gpt-5.5", null),
        entry(ibm, "text-embedding-3-large", 8_191),
      ]),
      provider(openai, [entry(openai, "gpt-5.5", 1_000_000)]),
    ];
    expect(
      servedModels({ harness: "claude-code", binding: claude, providers }),
    ).toEqual([
      { name: "claude/ibm/aws/claude-opus-5-5", contextWindow: 200_000 },
      { name: "claude/ibm/gpt-5.5", contextWindow: null },
      {
        name: "claude/cb/rits/deepseek-ai/deepseek-v4.1-flash-1017",
        contextWindow: 1_048_576,
      },
    ]);
  });
});
