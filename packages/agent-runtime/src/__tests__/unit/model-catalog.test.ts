/**
 * TEST_OVERVIEW: The Model Catalog lists every granted provider Connection's
 * models under provider-qualified names, with per-model metadata layered from
 * the provider's own listing, the vendored LiteLLM price table and the
 * preset's per-endpoint constants, in that order. Each harness sees only the
 * providers whose dialects it speaks, named the way its manifest asks. A
 * failed listing keeps that Connection's last good list and never touches
 * another's. An Anthropic subscription token is listed like the key and
 * offered to Claude Code alone. A Connection the router never serves
 * (Bedrock) is listed as unsupported with no models; a harness that runs it
 * natively sees that Connection's models as its own names, which the router
 * never routes.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createModelCatalog,
  lookupPrice,
  normalizeModelKey,
  VENDORED_PRICE_TABLE,
} from "../../modules/model-catalog/index.js";
import type { ModelDiscovery } from "../../modules/runtime-channel/infrastructure/model-discovery.js";
import type { RuntimeEnvState } from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import type { ModelRouterBinding } from "../../modules/runtime-channel/manifest.js";

const HARNESSES: Record<string, ModelRouterBinding | undefined> = {
  "claude-code": {
    dialects: ["anthropic-messages"],
    namePrefix: "claude/",
    lowercaseNames: true,
    native: {
      templates: ["bedrock"],
      models: ["opus", "sonnet"],
    },
  },
  codex: { dialects: ["openai-responses"] },
  bob: { dialects: ["openai-chat"] },
  pi: { dialects: ["anthropic-messages", "openai-chat", "openai-responses"] },
  custom: undefined,
};

const ibmLayer = {
  id: "conn-ibm",
  template: "ibm-litellm",
  env: {
    OPENAI_BASE_URL: "https://ibm.example",
    OPENAI_API_KEY: "platform:conn:conn-ibm",
    OPENAI_PROXY_CONTEXT_WINDOW: "200000",
    OPENAI_PROXY_MAX_TOKENS: "32768",
  },
};
const cbLayer = {
  id: "conn-cb",
  template: "curve-bender",
  env: {
    OPENAI_BASE_URL: "https://cb.example",
    OPENAI_API_KEY: "platform:conn:conn-cb",
    OPENAI_PROXY_CONTEXT_WINDOW: "256000",
    OPENAI_PROXY_REASONING: "1",
  },
};
const cbDeploymentLayer = {
  id: "conn-cbd",
  template: "curve-bender-deployment",
  env: {
    OPENAI_BASE_URL: "https://cb.example",
    OPENAI_API_KEY: "platform:conn:conn-cbd",
    OPENAI_PROXY_CONTEXT_WINDOW: "256000",
    OPENAI_PROXY_REASONING: "1",
  },
};
const bobLayer = {
  id: "conn-bob",
  template: "bob",
  env: {
    BOB_DEFAULT_GATEWAY_URL: "https://bob.example",
    BOBSHELL_API_KEY: "platform:conn:conn-bob",
  },
};
const oauthLayer = {
  id: "conn-oauth",
  template: "anthropic-oauth",
  env: { CLAUDE_CODE_OAUTH_TOKEN: "platform:conn:conn-oauth" },
};
const bedrockLayer = {
  id: "conn-bedrock",
  template: "bedrock",
  env: { AWS_BEARER_TOKEN_BEDROCK: "platform:conn:conn-bedrock" },
};

type Listing = Record<
  string,
  { ids: string[]; info?: Record<string, object> } | "down"
>;

function discoveryFor(listing: Listing): ModelDiscovery & { calls: string[] } {
  const calls: string[] = [];
  const discover = (async (_spec, env) => {
    const base =
      env.PLATFORM_LLM_BASE_URL ??
      env.OPENAI_BASE_URL ??
      env.BOB_DEFAULT_GATEWAY_URL ??
      env.ANTHROPIC_BASE_URL;
    calls.push(base ?? "?");
    const answer = base ? listing[base] : undefined;
    if (!answer) return { status: "not-configured" as const };
    if (answer === "down") return { status: "unavailable" as const };
    const entries = answer.ids.map((id) => ({
      id,
      name: id,
      ...(answer.info?.[id] && { info: answer.info[id] }),
    }));
    return {
      status: "observed" as const,
      models: entries.map((e) => ({ value: e.id, name: e.id })),
      entries,
      via: "test",
    };
  }) as ModelDiscovery & { calls: string[] };
  discover.calls = calls;
  return discover;
}

function catalogWith(
  listing: Listing,
  providers: RuntimeEnvState["providers"],
  ready = true,
  retryMs?: { initial: number; max: number },
) {
  let state: RuntimeEnvState = { env: {}, providers, harnesses: [] };
  const discover = discoveryFor(listing);
  const catalog = createModelCatalog({
    envState: () => state,
    envReady: () => ready,
    discover,
    harnesses: HARNESSES,
    table: VENDORED_PRICE_TABLE,
    log: () => {},
    ...(retryMs && { retryMs }),
  });
  return {
    catalog,
    discover,
    setState: (next: RuntimeEnvState) => {
      state = next;
    },
  };
}

const BOTH: Listing = {
  "https://ibm.example": {
    ids: ["aws/claude-opus-4-8", "gpt-5.5", "text-embedding-3-large"],
  },
  "https://cb.example": {
    ids: ["rits/zai-org/glm-5-3", "rits/nvidia/NVIDIA-Nemotron-3-Ultra"],
  },
};

describe("the model catalog", () => {
  /** TEST_SCENARIO: An agent with IBM and Curve Bender gets both providers'
   * models under `ibm/…` and `cb/…`, providers in alias order, with limits
   * and prices from the table for the Claude and GLM families, the preset's
   * limits for a model the table lacks, and the layer recorded per value. */
  it("lists both providers with layered metadata", async () => {
    const { catalog } = catalogWith(BOTH, [ibmLayer, cbLayer]);
    await catalog.refresh();
    const names = catalog.entries().map((e) => e.name);
    expect(names).toEqual([
      "ibm/aws/claude-opus-4-8",
      "ibm/gpt-5.5",
      "ibm/text-embedding-3-large",
      "cb/rits/zai-org/glm-5-3",
      "cb/rits/nvidia/NVIDIA-Nemotron-3-Ultra",
    ]);
    const opus = catalog.resolve("ibm/aws/claude-opus-4-8")!;
    expect(opus.metadata.contextWindow).toBeGreaterThan(0);
    expect(opus.metadata.prices?.inputPerToken).toBeGreaterThan(0);
    expect(opus.metadata.source).toEqual({ limits: "table", prices: "table" });
    expect(opus.metadata.cacheControl).toBe("anthropic");
    const glm = catalog.resolve("cb/rits/zai-org/glm-5-3")!;
    expect(glm.metadata.source.limits).toBe("table");
    expect(glm.metadata.thinkingFormat).toBe("zai");
    expect(glm.metadata.reasoning).toBe(true);
    const nemotron = catalog.resolve("cb/rits/nvidia/NVIDIA-Nemotron-3-Ultra")!;
    expect(nemotron.metadata.source).toEqual({
      limits: "known",
      prices: "none",
    });
    expect(nemotron.metadata.contextWindow).toBe(262_144);
    expect(nemotron.metadata.prices).toBeNull();
  });

  /** TEST_SCENARIO: One endpoint serves models of very different lengths, so
   * the preset's endpoint-wide constant is right for only the one it was
   * measured on: Nemotron keeps the 262144 its deployment serves while every
   * other model of the same Connection still reads the preset. */
  it("keeps a measured window ahead of the endpoint's constant", async () => {
    const { catalog } = catalogWith(BOTH, [cbLayer]);
    await catalog.refresh();
    expect(
      catalog.resolve("cb/rits/nvidia/NVIDIA-Nemotron-3-Ultra")!.metadata,
    ).toMatchObject({
      contextWindow: 262_144,
      source: { limits: "known" },
    });
    expect(
      catalog.resolve("cb/rits/zai-org/glm-5-3")!.metadata.source.limits,
    ).toBe("table");
  });

  /** TEST_SCENARIO: Bob's gateway model-info carries the model's own limits and
   * prices, which outrank the table. */
  it("prefers what the provider's listing says", async () => {
    const { catalog } = catalogWith(
      {
        "https://bob.example": {
          ids: ["claude-sonnet-4-6"],
          info: {
            "claude-sonnet-4-6": {
              contextWindow: 180_000,
              maxOutputTokens: 8_192,
              prices: {
                inputPerToken: 1e-6,
                outputPerToken: 2e-6,
                cacheReadPerToken: null,
                cacheWritePerToken: null,
              },
            },
          },
        },
      },
      [bobLayer],
    );
    await catalog.refresh();
    const entry = catalog.resolve("bob/claude-sonnet-4-6")!;
    expect(entry.metadata.contextWindow).toBe(180_000);
    expect(entry.metadata.prices?.inputPerToken).toBe(1e-6);
    expect(entry.metadata.source).toEqual({
      limits: "provider",
      prices: "provider",
    });
  });

  /** TEST_SCENARIO: The platform's vLLM serves a smaller window than the price
   * table's row for the same family; the listing's window wins, and its
   * self-hosted models cost nothing. */
  it("takes the platform's window from its listing and prices it at zero", async () => {
    expect(
      lookupPrice(VENDORED_PRICE_TABLE, "deepseek-v4.1-flash")
        ?.max_input_tokens,
    ).toBe(1_000_000);
    const { catalog } = catalogWith(
      {
        "http://vllm.example:8000": {
          ids: ["deepseek-v4.1-flash"],
          info: { "deepseek-v4.1-flash": { contextWindow: 262_144 } },
        },
      },
      [
        {
          id: "conn-platform",
          template: "platform-llm",
          env: {
            PLATFORM_LLM_BASE_URL: "http://vllm.example:8000",
            PLATFORM_LLM_NAME: "Acme",
          },
        },
      ],
    );
    await catalog.refresh();
    const entry = catalog.resolve("platform/deepseek-v4.1-flash")!;
    expect(entry.metadata.contextWindow).toBe(262_144);
    expect(entry.metadata.prices).toEqual({
      inputPerToken: 0,
      outputPerToken: 0,
      cacheReadPerToken: 0,
      cacheWritePerToken: 0,
    });
    expect(entry.metadata.source).toEqual({
      limits: "provider",
      prices: "provider",
    });
    expect(entry.dialects).toHaveLength(3);
    expect(catalog.providers()[0]?.displayName).toBe("Acme");
  });
  /** TEST_SCENARIO: the deployment's CurveBender Connection lists through the
   * same preset and under the same `cb/…` alias as the user-keyed one, and
   * each shows the name of its own integration. */
  it("lists the deployment CurveBender like the user-keyed one", async () => {
    const { catalog } = catalogWith(BOTH, [cbDeploymentLayer]);
    await catalog.refresh();
    expect(catalog.entries().map((e) => e.name)).toEqual([
      "cb/rits/zai-org/glm-5-3",
      "cb/rits/nvidia/NVIDIA-Nemotron-3-Ultra",
    ]);
    expect(catalog.providers()[0]?.displayName).toBe("CurveBender");

    const keyed = catalogWith(BOTH, [cbLayer]);
    await keyed.catalog.refresh();
    expect(keyed.catalog.providers()[0]?.displayName).toBe(
      "CurveBender custom key",
    );
  });

  /** TEST_SCENARIO: Curve Bender's listing fails on a refresh; its last list
   * stays, marked unavailable, and IBM's fresh list is untouched. A Connection
   * that was never listed shows unavailable with no models. */
  it("keeps a provider's last good list through a failed refresh", async () => {
    const listing: Listing = { ...BOTH };
    const { catalog, setState } = catalogWith(listing, [ibmLayer, cbLayer]);
    await catalog.refresh();
    listing["https://cb.example"] = "down";
    listing["https://ibm.example"] = { ids: ["gpt-5.5"] };
    setState({
      env: {},
      providers: [ibmLayer, cbLayer, bobLayer],
      harnesses: [],
    });
    await catalog.refresh();
    const byId = Object.fromEntries(
      catalog.providers().map((p) => [p.connectionId, p]),
    );
    expect(byId["conn-ibm"]!.status).toBe("listed");
    expect(byId["conn-ibm"]!.entries.map((e) => e.name)).toEqual([
      "ibm/gpt-5.5",
    ]);
    expect(byId["conn-cb"]!.status).toBe("unavailable");
    expect(byId["conn-cb"]!.entries).toHaveLength(2);
    expect(byId["conn-bob"]!.status).toBe("unavailable");
    expect(byId["conn-bob"]!.entries).toEqual([]);
  });

  /** TEST_SCENARIO: Codex speaks Responses only, so it never sees an
   * Anthropic-key model; Claude Code sees every name lowercased under
   * `claude/` and resolves it back to the upstream id; a harness with no
   * modelRouter section is not routed. */
  it("renders each harness's view by dialect and naming", async () => {
    const { catalog } = catalogWith(
      { ...BOTH, "https://api.anthropic.com": { ids: ["claude-opus-5-5"] } },
      [ibmLayer, cbLayer, oauthLayer],
    );
    await catalog.refresh();
    expect(catalog.forHarness("claude-code").map((e) => e.name)).toContain(
      "claude/cb/rits/nvidia/nvidia-nemotron-3-ultra",
    );
    expect(
      catalog
        .forHarness("claude-code")
        .every((e) => e.name.startsWith("claude/")),
    ).toBe(true);
    expect(catalog.forHarness("codex").map((e) => e.alias)).not.toContain(
      "anthropic",
    );
    expect(catalog.forHarness("custom")).toEqual([]);
    expect(
      catalog.resolve(
        "claude/cb/rits/nvidia/nvidia-nemotron-3-ultra",
        "claude-code",
      )?.upstreamId,
    ).toBe("rits/nvidia/NVIDIA-Nemotron-3-Ultra");
    const view = catalog.view("codex");
    expect(view.routed).toBe(true);
    expect(view.providers.map((p) => p.models.length)).toEqual([3, 2, 0]);
  });

  /** TEST_SCENARIO: An Anthropic subscription (OAuth) token is listed from
   * Anthropic's model list on the token, under the Anthropic alias, and is
   * routed like the key; Anthropic accepts the token from Claude Code alone,
   * so Claude Code's view lists its models while Pi, which speaks the same
   * Messages API, sees the Connection as unsupported with no models. */
  it("lists a subscription token's models for Claude Code alone", async () => {
    const { catalog } = catalogWith(
      {
        ...BOTH,
        "https://api.anthropic.com": {
          ids: ["claude-opus-5-5", "claude-sonnet-5-5"],
        },
      },
      [ibmLayer, oauthLayer],
    );
    await catalog.refresh();
    const oauthFor = (harness: string) =>
      catalog
        .view(harness)
        .providers.find((p) => p.connectionId === "conn-oauth")!;
    expect(oauthFor("claude-code").status).toBe("listed");
    expect(
      oauthFor("claude-code").models.map((m) => [m.name, m.upstreamId]),
    ).toEqual([
      ["claude/anthropic/claude-opus-5-5", "claude-opus-5-5"],
      ["claude/anthropic/claude-sonnet-5-5", "claude-sonnet-5-5"],
    ]);
    expect(oauthFor("pi")).toMatchObject({ status: "unsupported", models: [] });
    expect(catalog.forHarness("pi").map((e) => e.alias)).not.toContain(
      "anthropic",
    );
    expect(
      catalog.resolve("claude/anthropic/claude-sonnet-5-5", "claude-code"),
    ).toMatchObject({
      template: "anthropic-oauth",
      harnesses: ["claude-code"],
    });
  });

  /** TEST_SCENARIO: Bedrock never passes the router, but Claude Code runs it
   * natively: Claude Code's view lists the Connection under its alias with
   * Claude Code's own tier names, while Codex still sees it as unsupported,
   * and the router neither lists nor resolves those names. */
  it("lists a natively run Connection's models for that harness only", async () => {
    const { catalog } = catalogWith(BOTH, [ibmLayer, bedrockLayer]);
    await catalog.refresh();
    const bedrock = catalog
      .view("claude-code")
      .providers.find((p) => p.connectionId === "conn-bedrock")!;
    expect(bedrock.status).toBe("listed");
    expect(bedrock.models.map((m) => [m.name, m.upstreamId])).toEqual([
      ["claude/bedrock/opus", "opus"],
      ["claude/bedrock/sonnet", "sonnet"],
    ]);
    expect(
      catalog
        .view("codex")
        .providers.find((p) => p.connectionId === "conn-bedrock")?.status,
    ).toBe("unsupported");
    expect(catalog.entries().some((e) => e.alias === "bedrock")).toBe(false);
    expect(catalog.resolve("claude/bedrock/sonnet", "claude-code")).toBeNull();
  });

  /** TEST_SCENARIO: Bob's gateway serves chat completions only, so Claude
   * Code, which speaks Messages, cannot run on it: Claude Code's view says
   * the provider is unsupported rather than listed with no models, while
   * Bob's own view lists them. */
  it("marks a listed provider unsupported for a harness it cannot serve", async () => {
    const { catalog } = catalogWith(
      { ...BOTH, "https://bob.example": { ids: ["fast"] } },
      [ibmLayer, bobLayer],
    );
    await catalog.refresh();
    const bobFor = (harness: string) =>
      catalog
        .view(harness)
        .providers.find((p) => p.connectionId === "conn-bob")!;
    expect(bobFor("claude-code")).toMatchObject({
      status: "unsupported",
      models: [],
    });
    expect(bobFor("bob").status).toBe("listed");
    expect(bobFor("bob").models.map((m) => m.upstreamId)).toEqual(["fast"]);
  });

  /** TEST_SCENARIO: Nothing is listed before the env rail is materialised,
   * and no provider is asked. Once it is, a granted provider is known from
   * its env layer before its first listing, as unavailable with no models,
   * so a harness process spawned on a fresh pod is still pointed at the
   * router, and the picker's view shows it rather than nothing. */
  it("knows a granted provider before its first listing, nothing before the env", async () => {
    const { catalog, discover } = catalogWith(BOTH, [ibmLayer], false);
    await catalog.refresh();
    expect(catalog.entries()).toEqual([]);
    expect(catalog.providers()).toEqual([]);
    expect(discover.calls).toEqual([]);
    const ready = catalogWith(BOTH, [ibmLayer]);
    expect(ready.catalog.providers()).toMatchObject([
      {
        connectionId: "conn-ibm",
        alias: "ibm",
        status: "unavailable",
        entries: [],
      },
    ]);
    expect(ready.catalog.view("pi").providers).toMatchObject([
      { connectionId: "conn-ibm", status: "unavailable", listedAt: null },
    ]);
    await ready.catalog.refresh();
    expect(ready.catalog.providers()[0]?.status).toBe("listed");
  });

  /** TEST_SCENARIO: A grant restarts the agent's egress gateway, so the
   * listings right after it fail. Failures retry on a doubling delay, and a
   * refresh from an env change starts the delay over, so a provider lists
   * soon after the gateway is back rather than after a long backoff. */
  it("retries a failed listing from the shortest delay after every env change", async () => {
    vi.useFakeTimers();
    try {
      const { catalog, discover } = catalogWith(
        { "https://ibm.example": "down" },
        [ibmLayer],
        true,
        { initial: 1_000, max: 60_000 },
      );
      catalog.start();
      await catalog.refresh();
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(discover.calls).toHaveLength(3);
      await catalog.refresh();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(discover.calls).toHaveLength(5);
      catalog.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the vendored price table", () => {
  /** TEST_SCENARIO: Providers serve families under deployment prefixes and
   * Bedrock profile names; the lookup finds the family row for each. */
  it("finds a family through deployment prefixes and profile names", () => {
    expect(normalizeModelKey("rits/zai-org/GLM-5.3")).toBe("glm-5-3");
    expect(lookupPrice(VENDORED_PRICE_TABLE, "aws/claude-opus-4-8")?.key).toBe(
      "claude-opus-4-8",
    );
    expect(lookupPrice(VENDORED_PRICE_TABLE, "gpt-5.5")?.key).toBe("gpt-5.5");
    expect(
      lookupPrice(VENDORED_PRICE_TABLE, "us.anthropic.claude-opus-4-8-v1:0")
        ?.key,
    ).toBe("claude-opus-4-8");
    expect(
      lookupPrice(VENDORED_PRICE_TABLE, "rits/zai-org/glm-5-3"),
    ).not.toBeNull();
    expect(lookupPrice(VENDORED_PRICE_TABLE, "no-such-model-9000")).toBeNull();
  });
});
