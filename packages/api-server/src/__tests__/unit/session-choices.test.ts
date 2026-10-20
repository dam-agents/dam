import { describe, it, expect } from "vitest";
import type { HarnessCatalog } from "api-server-api";
import type { SessionPair } from "api-server-api";
import { resolveFirePair } from "../../modules/harness-config/services/harness-config-service.js";
import { createSessionChoicesValidator } from "../../modules/harness-config/services/session-choices.js";

/**
 * TEST_OVERVIEW: the one check a schedule's harness, model and settings pass
 * at save and at fire on a runtime that routes by model name, and the
 * pre-router rule it keeps for a runtime that does not.
 */

const CATALOG: HarnessCatalog = {
  default: "claude-code",
  harnesses: [
    {
      name: "claude-code",
      displayName: "Claude",
      providers: ["ibm-litellm", "anthropic"],
      tags: [],
      experimental: false,
    },
    {
      name: "codex",
      displayName: "Codex",
      providers: ["ibm-litellm", "openai"],
      tags: [],
      experimental: false,
    },
  ],
  telemetryEnv: () => [],
};

const ROUTED = {
  modelRouter: true,
  defaultHarness: "claude-code",
  harnesses: [
    {
      name: "claude-code",
      harnessConfig: true,
      sessionModel: true,
      sessionSettings: ["effort"],
      harnessConfigCatalog: {
        options: [
          {
            id: "effort",
            name: "Effort",
            category: "other",
            choices: [
              { value: "low", name: "Low" },
              { value: "high", name: "High" },
            ],
          },
        ],
        modelConstraints: { mini: { effort: ["low"] } },
      },
    },
    { name: "codex", harnessConfig: true, sessionModel: true },
  ],
};

function validator(over?: {
  capabilities?: unknown;
  granted?: { id: string; type: "ibm-litellm" | "openai" | "anthropic" }[];
  listed?: Record<string, string[] | null>;
}) {
  return createSessionChoicesValidator({
    catalog: CATALOG,
    pairRepo: {
      read: async () => null,
      grantedProviders: async () =>
        over?.granted ?? [{ id: "lite", type: "ibm-litellm" }],
    },
    snapshotRepo: {
      read: async (_agentId, harness) => {
        const models = over?.listed?.[harness ?? "claude-code"];
        return models === undefined || models === null
          ? null
          : ({
              availableModels: models.map((value) => ({ value, name: value })),
            } as never);
      },
    },
    getCapabilities: async () => over?.capabilities ?? ROUTED,
    firePair: async () => undefined,
  });
}

describe("session choices on a runtime that routes by model name", () => {
  /** TEST_SCENARIO: Harness carried, model qualified on a granted provider
   * the harness accepts and listed by it, setting valid for the model. */
  it("accepts a harness, model and setting that all hold", async () => {
    const check = validator({ listed: { "claude-code": ["ibm/gpt-5.5"] } });
    await expect(
      check("agent-1", {
        harness: "claude-code",
        model: "ibm/gpt-5.5",
        settings: { effort: "high" },
      }),
    ).resolves.toBeUndefined();
  });

  /** TEST_SCENARIO: A bare model name says nothing about its provider, so it
   * is refused with the spelling to use. */
  it("refuses a bare model name", async () => {
    await expect(validator()("agent-1", { model: "opus" })).resolves.toMatch(
      /<provider>\/opus/,
    );
  });

  /** TEST_SCENARIO: The model names a provider the agent does not hold, or
   * one the chosen harness cannot run on. */
  it("refuses a model on a provider the agent lacks or the harness rejects", async () => {
    const check = validator({
      granted: [
        { id: "lite", type: "ibm-litellm" },
        { id: "claude", type: "anthropic" },
      ],
    });
    await expect(
      check("agent-1", { model: "openai/gpt-5.5" }),
    ).resolves.toMatch(/holds no openai provider/);
    await expect(
      check("agent-1", {
        harness: "codex",
        model: "anthropic/claude-opus-4-8",
      }),
    ).resolves.toMatch(/codex harness cannot run on anthropic/);
  });

  /** TEST_SCENARIO: The harness has reported its model list and the chosen
   * model is not on it; with no list reported yet the model passes. */
  it("checks the model against the harness's reported list when there is one", async () => {
    await expect(
      validator({ listed: { "claude-code": ["ibm/gpt-5-mini"] } })("agent-1", {
        model: "ibm/gpt-5.5",
      }),
    ).resolves.toMatch(/does not list ibm\/gpt-5.5/);
    await expect(
      validator()("agent-1", { model: "ibm/gpt-5.5" }),
    ).resolves.toBeUndefined();
  });

  /** TEST_SCENARIO: A harness the agent's image does not carry, a setting the
   * harness does not offer, and a value the model does not allow. */
  it("refuses an uncarried harness and a setting the harness or model rejects", async () => {
    const check = validator();
    await expect(check("agent-1", { harness: "pi" })).resolves.toMatch(
      /does not carry the pi harness/,
    );
    await expect(
      check("agent-1", { harness: "codex", settings: { effort: "high" } }),
    ).resolves.toMatch(/codex harness cannot set effort/);
    await expect(
      check("agent-1", {
        model: "ibm/gpt-5-mini",
        settings: { effort: "high" },
      }),
    ).resolves.toMatch(/not available for ibm\/gpt-5-mini/);
  });
});

describe("session choices on a runtime without the router", () => {
  const legacy = {
    sessionModel: true,
    harnessConfigCatalog: {
      options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          choices: [
            { value: "sonnet", name: "Sonnet" },
            { value: "claude/azure/gpt-5.5", name: "GPT 5.5" },
          ],
        },
      ],
    },
  };

  /** TEST_SCENARIO: Such a runtime takes no harness or settings; its model
   * must be one of the listed choices, as before the router. A name the
   * migration qualified with its provider still passes when the old list
   * carries it in the old spelling (bare, or under Claude Code's prefix). */
  it("keeps the listed-choices rule and refuses harness or settings", async () => {
    const check = validator({ capabilities: legacy });
    await expect(
      check("agent-1", { model: "sonnet" }),
    ).resolves.toBeUndefined();
    await expect(
      check("agent-1", { model: "ibm/sonnet" }),
    ).resolves.toBeUndefined();
    await expect(
      check("agent-1", { model: "ibm/azure/gpt-5.5" }),
    ).resolves.toBeUndefined();
    await expect(check("agent-1", { model: "opus" })).resolves.toMatch(
      /choose one of: sonnet/,
    );
    await expect(check("agent-1", { model: "ibm/opus" })).resolves.toMatch(
      /choose one of: sonnet/,
    );
    await expect(check("agent-1", { harness: "codex" })).resolves.toMatch(
      /takes no harness or settings/,
    );
  });
});

describe("a subagent model beside a natively run provider", () => {
  const capabilities = {
    ...ROUTED,
    harnesses: [
      {
        name: "claude-code",
        harnessConfig: true,
        sessionModel: true,
        sessionSettings: ["subagentModel"],
        nativeTemplates: ["bedrock"],
        harnessConfigCatalog: {
          options: [
            {
              id: "subagentModel",
              name: "Subagent model",
              category: "model",
              choices: [],
            },
          ],
        },
      },
    ],
  };
  const catalog = {
    ...CATALOG,
    harnesses: [
      {
        ...CATALOG.harnesses[0]!,
        providers: ["ibm-litellm", "anthropic", "bedrock"],
      },
    ],
  } as HarnessCatalog;
  const IBM = { id: "lite", type: "ibm-litellm", templateId: "ibm-litellm" };
  const BEDROCK = { id: "bed", type: "bedrock", templateId: "bedrock" };
  const checkFor = (
    granted: (typeof IBM)[],
    saved: SessionPair | null = null,
  ) => {
    const pairRepo = {
      read: async () => saved,
      write: async () => {},
      grantedProviders: async () => granted as never,
    };
    return createSessionChoicesValidator({
      catalog,
      pairRepo,
      snapshotRepo: { read: async () => null },
      getCapabilities: async () => capabilities,
      firePair: (agentId, preferred) =>
        resolveFirePair(
          {
            catalog,
            pairRepo,
            getCapabilities: async () => capabilities,
            specHarness: async () => undefined,
          },
          agentId,
          preferred,
        ),
    });
  };

  /** TEST_SCENARIO: One Claude Code process reaches either the Model Router
   * or Bedrock, so a schedule whose fire model and subagent model sit on
   * different sides is refused at save, not on every fire. A schedule with no
   * model fires on the saved default; with none saved the fire's side is not
   * known, so the save check passes and the fire reports the missing default. */
  it("refuses a subagent model on the other side of the model the fire runs", async () => {
    const both = checkFor([IBM, BEDROCK]);
    expect(
      await both("a", {
        model: "ibm/gpt-5.5",
        settings: { subagentModel: "bedrock/opus" },
      }),
    ).toMatch(
      /subagentModel setting bedrock\/opus cannot run beside ibm\/gpt-5\.5/,
    );
    expect(
      await both("a", {
        model: "bedrock/sonnet",
        settings: { subagentModel: "bedrock/haiku" },
      }),
    ).toBeUndefined();
    expect(
      await both("a", { settings: { subagentModel: "bedrock/haiku" } }),
    ).toBeUndefined();

    const savedIbm = checkFor([IBM, BEDROCK], {
      harness: "claude-code",
      provider: "lite",
      model: "ibm/gpt-5.5",
    });
    expect(
      await savedIbm("a", { settings: { subagentModel: "bedrock/haiku" } }),
    ).toMatch(/cannot run beside ibm\/gpt-5\.5/);
  });

  /** TEST_SCENARIO: The saved default names a model on a provider since
   * revoked, so the agent has no default model; the save check does not
   * guess a side for the fire, which reports the missing default instead. */
  it("passes the side check while the agent has no default model", async () => {
    const check = checkFor([BEDROCK], {
      harness: "claude-code",
      provider: "gone",
      model: "anthropic/claude-sonnet-5-5",
    });
    expect(
      await check("a", { settings: { subagentModel: "claude/ibm/gpt-5.5" } }),
    ).toBeUndefined();
  });
});
