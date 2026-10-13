/**
 * TEST_OVERVIEW: The env a harness process gets to run on the Model Router:
 * the router's address for every harness, and for Claude Code the tier
 * slots filled from the agent's default provider (newest model per tier,
 * with the old gateway's fallbacks) as catalog names, plus the smallest
 * context window the harness may run on as the process-wide cap.
 */
import { describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
} from "../../modules/model-catalog/index.js";
import { routerEnvFor, tierModels } from "../../modules/model-router/index.js";
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
};

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
   * Claude Code names them, and the context cap is the smallest window across
   * IBM's and Curve Bender's models; the OpenAI key serves no Messages API and
   * takes no part. A harness without claudeTiers gets the address only, plus
   * the router's placeholder in the key variable its client insists on
   * (Codex refuses to list models without OPENAI_API_KEY).
   * Every harness a granted provider serves is marked as served, even before
   * that provider has listed, so Claude Code does not start on Anthropic's
   * own endpoint while the first listing is still out; with nothing granted
   * there is no mark. */
  it("fills Claude Code's tiers from the default provider and caps the window", () => {
    const providers = [
      provider(openai, [entry(openai, "gpt-5.5", 1_000_000)]),
      provider(cb, [entry(cb, "rits/zai-org/glm-5-3", 128_000)]),
      provider(ibm, [
        entry(ibm, "aws/claude-opus-4-8", 200_000),
        entry(ibm, "aws/claude-sonnet-4-6", 200_000),
        entry(ibm, "gpt-5.5", null),
      ]),
    ];
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
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "128000",
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
