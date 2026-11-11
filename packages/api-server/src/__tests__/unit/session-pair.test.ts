import { describe, expect, it } from "vitest";
import type { HarnessCapability } from "agent-runtime-api";
import {
  choiceSlots,
  composedSubagent,
  resolvedChoice,
  runsNativelyIn,
  runSubagentSettings,
  resolveSessionPair,
  type SessionPairInputs,
} from "../../modules/harness-config/domain/session-pair.js";
import type {
  ProfileResolver,
  ResolvedProfile,
} from "../../modules/profiles/index.js";
import {
  createHarnessCatalog,
  harnessFits,
} from "../../modules/templates/domain/harness-catalog.js";
import {
  resolveFirePair,
  resolveRememberedPair,
} from "../../modules/harness-config/services/harness-config-service.js";

const RUNS_ON: Record<string, SessionPairInputs["granted"][number]["type"][]> =
  {
    "claude-code": ["ibm-litellm", "anthropic"],
    codex: ["ibm-litellm", "openai"],
  };

const inputs = (over: Partial<SessionPairInputs>): SessionPairInputs => ({
  remembered: null,
  agentHarness: "claude-code",
  defaultHarness: "claude-code",
  granted: [{ id: "lite", type: "ibm-litellm" }],
  fits: (h, type) => RUNS_ON[h]?.includes(type) ?? false,
  ...over,
});

describe("resolveSessionPair", () => {
  /** TEST_SCENARIO: A schedule fires on the pair a person last picked. */
  it("keeps the remembered pair while its provider is granted", () => {
    const remembered = { harness: "codex", provider: "lite", model: "gpt-5" };
    expect(resolveSessionPair(inputs({ remembered }))).toEqual(remembered);
  });

  /** TEST_SCENARIO: The migration qualified a saved model with its provider,
   * but this agent still runs an image from before qualified names, which
   * knows the model only as it listed it: the fire sends that spelling
   * (Claude Code's own `claude/<id>`), or the upstream id when the runtime
   * has listed nothing yet. */
  it("sends an old runtime the spelling it listed", () => {
    const remembered = {
      harness: "claude-code",
      provider: "lite",
      model: "ibm/azure/gpt-5.5",
    };
    expect(
      resolveSessionPair(
        inputs({
          remembered,
          availableModels: () => ["claude/azure/gpt-5.5", "sonnet"],
        }),
      ),
    ).toEqual({ ...remembered, model: "claude/azure/gpt-5.5" });
    expect(resolveSessionPair(inputs({ remembered }))).toEqual({
      ...remembered,
      model: "azure/gpt-5.5",
    });
  });

  /** TEST_SCENARIO: An agent nobody has picked for runs its own harness on
   * the first provider that harness can use. */
  it("starts an unpicked agent on its harness and first fitting provider", () => {
    expect(
      resolveSessionPair(
        inputs({
          agentHarness: "codex",
          granted: [
            { id: "claude", type: "anthropic" },
            { id: "oai", type: "openai" },
          ],
        }),
      ),
    ).toEqual({ harness: "codex", provider: "oai", model: null });
  });

  /** TEST_SCENARIO: A schedule saved before sessions chose providers names
   * only a model of the agent's harness; it runs on the first granted provider
   * that harness can use, keeping the model. */
  it("gives a pair that names no provider the first one its harness fits", () => {
    expect(
      resolveSessionPair(
        inputs({
          remembered: { harness: "codex", provider: null, model: "gpt-5" },
          granted: [
            { id: "claude", type: "anthropic" },
            { id: "oai", type: "openai" },
          ],
        }),
      ),
    ).toEqual({ harness: "codex", provider: "oai", model: "gpt-5" });
  });

  /** TEST_SCENARIO: The remembered provider's grant was removed. The fire
   * falls back to the default harness on a provider still granted, with no
   * model, since the old one belonged to the removed provider. */
  it("falls back to the default harness when the remembered provider is gone", () => {
    expect(
      resolveSessionPair(
        inputs({
          remembered: { harness: "codex", provider: "gone", model: "gpt-5" },
          granted: [{ id: "claude", type: "anthropic" }],
        }),
      ),
    ).toEqual({ harness: "claude-code", provider: "claude", model: null });
  });

  /** TEST_SCENARIO: No granted provider fits even the default harness, so the
   * fire fails visibly instead of running somewhere it cannot. */
  it("finds no pair when no granted provider fits", () => {
    expect(
      resolveSessionPair(
        inputs({
          remembered: { harness: "codex", provider: "gone", model: "gpt-5" },
          granted: [{ id: "oai", type: "openai" }],
        }),
      ),
    ).toBeNull();
  });

  /** TEST_SCENARIO: A harness the operator turned off is listed nowhere, so a
   * remembered pair on it fits no provider and the fire moves to the default
   * harness rather than running a harness the install no longer offers. */
  it("moves a remembered pair off a harness the catalog does not list", () => {
    expect(
      resolveSessionPair(
        inputs({
          remembered: { harness: "pi", provider: "lite", model: "m" },
        }),
      ),
    ).toEqual({ harness: "claude-code", provider: "lite", model: null });
  });

  /** TEST_SCENARIO: The agent's last provider grant was removed, and it holds
   * its model key some other way. The fire still runs on the remembered
   * harness, with no provider and without the removed provider's model. */
  it("runs with no provider once none is granted", () => {
    expect(
      resolveSessionPair(
        inputs({
          remembered: { harness: "codex", provider: "gone", model: "gpt-5" },
          granted: [],
        }),
      ),
    ).toEqual({ harness: "codex", provider: null, model: null });
  });
});

describe("resolveSessionPair on a runtime that routes by model name", () => {
  const routed = (over: Partial<SessionPairInputs>) =>
    resolveSessionPair(inputs({ routed: true, ...over }));

  /** TEST_SCENARIO: The saved pair is for this harness and its provider is
   * still granted, so the run keeps its qualified model and settings. */
  it("keeps the saved qualified model and settings for its own harness", () => {
    const remembered = {
      harness: "codex",
      provider: "oai",
      model: "openai/gpt-5.5",
      settings: { effort: "high" },
    };
    expect(
      routed({
        remembered,
        granted: [
          { id: "lite", type: "ibm-litellm" },
          { id: "oai", type: "openai" },
        ],
      }),
    ).toEqual(remembered);
  });

  /** TEST_SCENARIO: The saved model's provider is gone. The run stays on the
   * saved harness but takes no other provider or model in its place, so it
   * reports that the agent has no default model rather than running on one
   * the person never picked. */
  it("stays on the harness and leaves the model unset when its provider is gone", () => {
    expect(
      routed({
        remembered: { harness: "codex", provider: "gone", model: "cb/glm" },
        granted: [
          { id: "oai", type: "openai" },
          { id: "lite", type: "ibm-litellm" },
        ],
        availableModels: () => [
          "openai/gpt-5.5",
          "ibm/gpt-5.5",
          "ibm/aws/opus",
        ],
      }),
    ).toEqual({ harness: "codex", provider: null, model: null });
  });

  /** TEST_SCENARIO: A schedule names a model on a provider other than the
   * agent's default for the harness. The run goes to the provider the model
   * names, since the agent holds it and the harness accepts it. */
  it("takes the provider the remembered model names over the default", () => {
    expect(
      routed({
        remembered: {
          harness: "codex",
          provider: null,
          model: "openai/gpt-5.5",
        },
        granted: [
          { id: "lite", type: "ibm-litellm" },
          { id: "oai", type: "openai" },
        ],
      }),
    ).toEqual({ harness: "codex", provider: "oai", model: "openai/gpt-5.5" });
  });

  /** TEST_SCENARIO: No granted provider fits the saved harness, so the run
   * fails rather than jumping to the platform default harness. */
  it("fails on the saved harness instead of moving to the default one", () => {
    expect(
      routed({
        remembered: { harness: "codex", provider: null, model: null },
        granted: [{ id: "claude", type: "anthropic" }],
      }),
    ).toBeNull();
  });

  /** TEST_SCENARIO: A run asked for on a harness with no pair saved for it
   * (the fire resolver passes an empty pair for the requested harness) takes
   * no provider or model the person did not pick. */
  it("leaves provider and model unset for a harness with nothing saved", () => {
    expect(
      routed({
        remembered: { harness: "codex", provider: null, model: null },
        agentHarness: "claude-code",
        granted: [{ id: "lite", type: "ibm-litellm" }],
      }),
    ).toEqual({ harness: "codex", provider: null, model: null });
  });

  /** TEST_SCENARIO: Claude Code's own spelling of a saved model folds into
   * the canonical name; a bare saved name is no model on this runtime. */
  it("canonicalises Claude Code's spelling and drops bare names", () => {
    expect(
      routed({
        remembered: {
          harness: "claude-code",
          provider: "lite",
          model: "claude/ibm/aws/claude-opus-4-8",
        },
      })?.model,
    ).toBe("ibm/aws/claude-opus-4-8");
    expect(
      routed({
        remembered: { harness: "claude-code", provider: "lite", model: "opus" },
      })?.model,
    ).toBeNull();
  });
});

describe("resolveFirePair", () => {
  /** TEST_SCENARIO: A schedule saved with only a model was set up against the
   * provider the person last picked for this harness, so it fires there, not
   * on whichever provider was granted first. */
  it("keeps the remembered provider for a schedule that names only a model", async () => {
    const pair = await resolveFirePair(
      {
        ownerCatalog: async () => ({ providers: [] }),
        pairRepo: {
          readSaved: async () => ({
            chat: null,
            channel: null,
            scheduled: null,
            chatProfileId: null,
          }),
          read: async () => ({
            harness: "claude-code",
            provider: "second",
            model: "old",
          }),
          grantedProviders: async () => [
            { id: "first", type: "ibm-litellm" },
            { id: "second", type: "anthropic" },
          ],
        },
        catalog: {
          default: "claude-code",
          harnesses: [
            {
              name: "claude-code",
              displayName: "Claude",
              providers: ["ibm-litellm", "anthropic"],
              tags: [],
              experimental: false,
            },
          ],
          telemetryEnv: () => [],
        },
        specHarness: async () => undefined,
        getCapabilities: async () => ({
          defaultHarness: "claude-code",
          harnesses: [
            {
              name: "claude-code",
              harnessConfig: true,
              sessionModel: true,
              sessionSettings: ["mode"],
            },
          ],
        }),
      },
      "agent-1",
      "scheduled",
      { model: "opus" },
    );
    expect(pair).toEqual({
      harness: "claude-code",
      provider: "second",
      model: "opus",
    });
  });
});

describe("resolveRememberedPair before the agent's first hello", () => {
  /** TEST_SCENARIO: A new agent from a template whose harness is not the
   * catalog default has reported no capabilities yet. Its expected pair is
   * that harness on a provider it fits, not the catalog default's. */
  it("starts on the Agent's own harness", async () => {
    expect(
      await resolveRememberedPair(
        {
          ownerCatalog: async () => ({ providers: [] }),
          pairRepo: {
            readSaved: async () => ({
              chat: null,
              channel: null,
              scheduled: null,
              chatProfileId: null,
            }),
            read: async () => null,
            grantedProviders: async () => [
              { id: "claude", type: "anthropic" },
              { id: "oai", type: "openai" },
            ],
          },
          catalog: {
            default: "claude-code",
            harnesses: [
              {
                name: "claude-code",
                displayName: "Claude",
                providers: ["anthropic"],
                tags: [],
                experimental: false,
              },
              {
                name: "codex",
                displayName: "Codex",
                providers: ["openai"],
                tags: [],
                experimental: false,
              },
            ],
            telemetryEnv: () => [],
          },
          specHarness: async () => "codex",
          getCapabilities: async () => null,
        },
        "agent-1",
        "chat",
      ),
    ).toEqual({ harness: "codex", provider: "oai", model: null });
  });
});
describe("resolveFirePair on an agent too old for session pairs", () => {
  /** TEST_SCENARIO: An image built before session settings carries Pi with a
   * harness config but drops a lease's model, so Pi would fall back to its
   * built-in Anthropic default. Schedule fires and channel turns name no pair
   * there, and the runtime runs them on the agent's own defaults. */
  it("names no pair when a configured harness lacks session settings", async () => {
    const pair = await resolveFirePair(
      {
        ownerCatalog: async () => ({ providers: [] }),
        pairRepo: {
          readSaved: async () => ({
            chat: null,
            channel: null,
            scheduled: null,
            chatProfileId: null,
          }),
          read: async () => ({
            harness: "pi",
            provider: "curve",
            model: "rits/zai-org/glm-5-3",
          }),
          grantedProviders: async () => [{ id: "curve", type: "curve-bender" }],
        },
        catalog: {
          default: "claude-code",
          harnesses: [
            {
              name: "pi",
              displayName: "Pi",
              providers: ["curve-bender"],
              tags: [],
              experimental: false,
            },
          ],
          telemetryEnv: () => [],
        },
        specHarness: async () => undefined,
        getCapabilities: async () => ({
          defaultHarness: "pi",
          harnesses: [{ name: "pi", harnessConfig: true, sessionModel: false }],
        }),
      },
      "agent-1",
      "scheduled",
      {},
    );
    expect(pair).toBeUndefined();
  });
});
describe("resolveFirePair on a harness outside the catalog", () => {
  /** TEST_SCENARIO: A custom template's agent, such as the e2e mock, runs a
   * harness the catalog does not offer. Its channel turns and schedule fires
   * name no pair, so its runtime runs them on its own harness, rather than
   * failing for want of a provider the catalog would fit. */
  it("names no pair for an agent whose harness the catalog does not list", async () => {
    const pair = await resolveFirePair(
      {
        ownerCatalog: async () => ({ providers: [] }),
        pairRepo: {
          readSaved: async () => ({
            chat: null,
            channel: null,
            scheduled: null,
            chatProfileId: null,
          }),
          read: async () => null,
          grantedProviders: async () => [{ id: "lite", type: "ibm-litellm" }],
        },
        catalog: {
          default: "claude-code",
          harnesses: [],
          telemetryEnv: () => [],
        },
        specHarness: async () => undefined,
        getCapabilities: async () => ({
          defaultHarness: "mock",
          harnesses: [
            { name: "mock", harnessConfig: false, sessionModel: false },
          ],
        }),
      },
      "agent-1",
      "scheduled",
      {},
    );
    expect(pair).toBeUndefined();
  });

  /** TEST_SCENARIO: The chat's picker asks for the remembered pair too; for
   * such an agent there is none, so a new session runs on the agent's own
   * harness instead of on the catalog's default one its image may also carry. */
  it("remembers no pair for an agent whose harness the catalog does not list", async () => {
    expect(
      await resolveRememberedPair(
        {
          ownerCatalog: async () => ({ providers: [] }),
          pairRepo: {
            readSaved: async () => ({
              chat: null,
              channel: null,
              scheduled: null,
              chatProfileId: null,
            }),
            read: async () => null,
            grantedProviders: async () => [{ id: "lite", type: "ibm-litellm" }],
          },
          catalog: {
            default: "claude-code",
            harnesses: [
              {
                name: "claude-code",
                displayName: "Claude",
                tags: [],
                experimental: false,
              },
            ],
            telemetryEnv: () => [],
          },
          specHarness: async () => undefined,
          getCapabilities: async () => ({
            defaultHarness: "mock",
            harnesses: [
              { name: "mock", harnessConfig: false, sessionModel: false },
              { name: "claude-code", harnessConfig: true, sessionModel: true },
            ],
          }),
        },
        "agent-1",
        "chat",
      ),
    ).toBeNull();
  });
});

describe("the platform sub-agent a slot runs", () => {
  const LENT = {
    "platformSubagent.harness": "claude-code",
    "platformSubagent.model": "anthropic/claude-haiku-5",
  };
  const OWN = {
    "platformSubagent.harness": "codex",
    "platformSubagent.model": "openai/gpt-6.1-sol",
  };
  const PAIR = {
    harness: "claude-code",
    provider: "conn-1",
    model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  };
  const UNAVAILABLE =
    "Anthropic, its sub-agent's provider, isn't attached to this agent";
  /* UNIT_BOUNDARY_DESCRIPTION: the owner's listing for the primary's Connection and harness, which is what says a model runs natively (D193B). */
  const CATALOG = {
    providers: [
      {
        connectionId: "conn-1",
        alias: "anthropic",
        template: "anthropic",
        displayName: "Anthropic",
        status: "listed",
        listedAt: null,
        harnesses: ["claude-code"],
        models: [
          {
            name: "anthropic/claude-sonnet-5",
            upstreamId: "claude-sonnet-5",
            contextWindow: null,
            maxOutputTokens: null,
            reasoning: null,
            vision: null,
            prices: null,
            source: { limits: "none", prices: "none" },
            harnesses: ["claude-code"],
          },
        ],
      },
    ],
  } as unknown as Parameters<typeof runsNativelyIn>[0];
  /* UNIT_BOUNDARY_DESCRIPTION: Claude Code's real capability: it keeps the harness's own subagents' model and effort, and takes a platform sub-agent's harness and model (D193B). */
  const CLAUDE: HarnessCapability = {
    name: "claude-code",
    harnessConfig: true,
    sessionModel: true,
    sessionSettings: ["subagentModel", "subagentEffort"],
    harnessConfigCatalog: {
      options: [
        {
          id: "subagentModel",
          name: "Subagent model",
          category: "model",
          subagents: true,
          choices: [
            { value: "anthropic/claude-haiku-5", name: "Haiku" },
            { value: "anthropic/claude-sonnet-5", name: "Sonnet" },
            { value: "anthropic/claude-opus-5", name: "Opus" },
          ],
        },
        {
          id: "subagentEffort",
          name: "Subagent effort",
          category: "thought_level",
          subagents: true,
          choices: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
      ],
    },
  };
  /* UNIT_BOUNDARY_DESCRIPTION: one resolver for both profiles a case names, the primary and a subagent profile, by id. */
  const resolver =
    (
      byId: Record<
        string,
        {
          pair?: ResolvedProfile["pair"];
          unavailable?: string | null;
          subagent?: Record<string, string> | null;
          subagentUnavailable?: string | null;
        }
      >,
      primary = "p1",
    ): ProfileResolver =>
    async ({ profileId }) => {
      const entry = byId[profileId] ?? byId[primary]!;
      return {
        profile: { name: profileId },
        pair: entry.pair ?? PAIR,
        unavailable: entry.unavailable ?? null,
        subagent: entry.subagent ?? null,
        subagentUnavailable: entry.subagentUnavailable ?? null,
        attachable: false,
      } as unknown as ResolvedProfile;
    };

  /** TEST_SCENARIO: a profile names a platform sub-agent too (D193B), so a slot that follows it and holds no sub-agent of its own spawns it. */
  it("spawns the profile's sub-agent where the slot holds none", async () => {
    await expect(
      composedSubagent(
        { platformSubagentProfileId: null, platformSubagentSettings: null },
        { settings: LENT, unavailable: null },
        resolver({}),
        "agent-1",
      ),
    ).resolves.toEqual({ settings: LENT });
  });

  /** TEST_SCENARIO: a slot with values of its own replaces the profile's whole sub-agent, even one on another provider whose own provider is detached, so the turn never refuses over a sub-agent it does not use (D193B). */
  it("lets an own sub-agent slot win over the profile's", async () => {
    const profiles = resolver({
      p1: { subagent: LENT, subagentUnavailable: UNAVAILABLE },
    });
    await expect(
      resolvedChoice(
        {
          profileId: "p1",
          pair: null,
          platformSubagentProfileId: null,
          platformSubagentSettings: OWN,
        },
        profiles,
        "agent-1",
      ),
    ).resolves.toEqual({ pair: { ...PAIR, settings: OWN } });
    await expect(
      composedSubagent(
        { platformSubagentProfileId: null, platformSubagentSettings: OWN },
        { settings: LENT, unavailable: UNAVAILABLE },
        profiles,
        "agent-1",
      ),
    ).resolves.toEqual({ settings: OWN });
  });

  /** TEST_SCENARIO: a slot that names a subagent profile which cannot run clears the subagent for the agent to pick; it never falls back to the sub-agent the primary profile lends, and that holds for a chat and a schedule alike, which share this composition (D193B). */
  it("clears the slot when the subagent profile it names cannot run", async () => {
    const profiles = resolver({
      p1: { subagent: LENT },
      gone: { unavailable: "Pi isn't attached to this agent" },
    });
    await expect(
      resolvedChoice(
        {
          profileId: "p1",
          pair: null,
          platformSubagentProfileId: "gone",
          platformSubagentSettings: null,
        },
        profiles,
        "agent-1",
      ),
    ).resolves.toEqual({ pair: PAIR });
    await expect(
      composedSubagent(
        { platformSubagentProfileId: "gone", platformSubagentSettings: null },
        { settings: LENT, unavailable: null },
        profiles,
        "agent-1",
      ),
    ).resolves.toEqual({ settings: null });
  });

  /** TEST_SCENARIO: a slot holds platform keys only (D193B): the store drops the native keys the picker sent beside it, and the read-back that follows carries the platform slot and the primary's own settings alone. */
  it("stores platform keys only and answers platform-level", async () => {
    const picked = {
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "anthropic/claude-sonnet-5",
      "platformSubagent.effort": "high",
      subagentModel: "anthropic/claude-sonnet-5",
      subagentEffort: "high",
    };
    const stored = choiceSlots(
      { ...PAIR, settings: picked },
      { profileId: "p1", platformSubagentProfileId: null },
    );
    expect(stored.pair).toBeNull();
    expect(stored.platformSubagentSettings).toEqual({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "anthropic/claude-sonnet-5",
      "platformSubagent.effort": "high",
    });
    const profiles = resolver({
      p1: {
        pair: {
          ...PAIR,
          settings: {
            subagentModel: "anthropic/claude-haiku-5",
            subagentEffort: "low",
          },
        },
        subagent: LENT,
      },
    });
    await expect(
      resolvedChoice(
        {
          profileId: "p1",
          pair: stored.pair ?? null,
          platformSubagentProfileId: stored.platformSubagentProfileId ?? null,
          platformSubagentSettings: stored.platformSubagentSettings ?? null,
        },
        profiles,
        "agent-1",
      ),
    ).resolves.toEqual({
      pair: {
        ...PAIR,
        settings: {
          ...stored.platformSubagentSettings,
          subagentModel: "anthropic/claude-haiku-5",
          subagentEffort: "low",
        },
      },
    });
  });

  /** TEST_SCENARIO: the run's payload is where the one rule applies (D193B): with no effective sub-agent the pair keeps its own native values as they stand, which is what an old-shaped custom default carries, and with one it takes that sub-agent's, its own dropped. */
  it("derives at the run boundary, not before it", () => {
    const natives = {
      subagentModel: "anthropic/claude-sonnet-5",
      subagentEffort: "high",
    };
    const runs = {
      harness: "claude-code",
      provider: "conn-1",
      model: "anthropic/claude-opus-5",
    };
    expect(runSubagentSettings(CLAUDE, CATALOG, runs, natives)).toEqual(
      natives,
    );
    expect(
      runSubagentSettings(CLAUDE, CATALOG, runs, {
        subagentModel: "anthropic/claude-haiku-5",
        subagentEffort: "low",
        "platformSubagent.harness": "claude-code",
        "platformSubagent.model": "anthropic/claude-sonnet-5",
        "platformSubagent.effort": "high",
      }),
    ).toEqual({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "anthropic/claude-sonnet-5",
      "platformSubagent.effort": "high",
      subagentModel: "anthropic/claude-sonnet-5",
      subagentEffort: "high",
    });
  });

  /** TEST_SCENARIO: a model runs natively only where the primary's own Connection lists it for the primary harness — the same listing the picker offers — so a missing or unknown listing offers nothing and a routed model of another provider never becomes the harness's own subagent model (D193B). */
  it("takes a native model only from the primary's own Connection", () => {
    const runs = runsNativelyIn(CATALOG, {
      harness: "claude-code",
      provider: "conn-1",
    });
    expect(runs("anthropic/claude-sonnet-5")).toBe(true);
    expect(runs("openai/gpt-6.1-sol")).toBe(false);
    expect(runs("anthropic/claude-opus-5")).toBe(false);
    expect(
      runsNativelyIn(null, { harness: "claude-code", provider: "conn-1" })(
        "anthropic/claude-sonnet-5",
      ),
    ).toBe(false);
    expect(
      runsNativelyIn(CATALOG, { harness: "claude-code", provider: null })(
        "anthropic/claude-sonnet-5",
      ),
    ).toBe(false);
    expect(
      runSubagentSettings(
        CLAUDE,
        CATALOG,
        {
          harness: "claude-code",
          provider: "conn-1",
          model: "anthropic/claude-opus-5",
        },
        {
          "platformSubagent.harness": "claude-code",
          "platformSubagent.model": "openai/gpt-6.1-sol",
        },
      ),
    ).toEqual({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "openai/gpt-6.1-sol",
    });
  });

  /** TEST_SCENARIO: a sub-agent the profile lends and the agent cannot run refuses the run with its reason, rather than dropping a choice the owner made, and still answers the pair it names, which a run falls back on; a subagent profile lends only its primary model, so a nested sub-agent is never checked. */
  it("refuses a lent sub-agent it cannot run", async () => {
    const profiles = resolver({
      p1: { subagent: LENT, subagentUnavailable: UNAVAILABLE },
      nested: { subagent: LENT, subagentUnavailable: UNAVAILABLE },
    });
    await expect(
      resolvedChoice(
        {
          profileId: "p1",
          pair: null,
          platformSubagentProfileId: null,
          platformSubagentSettings: null,
        },
        profiles,
        "agent-1",
      ),
    ).resolves.toEqual({
      refused: { profile: "p1", detail: UNAVAILABLE },
      pair: PAIR,
    });
    await expect(
      composedSubagent(
        { platformSubagentProfileId: "nested", platformSubagentSettings: null },
        null,
        profiles,
        "agent-1",
      ),
    ).resolves.toEqual({
      settings: {
        "platformSubagent.harness": "claude-code",
        "platformSubagent.model": PAIR.model,
      },
    });
  });
});

describe("the harness catalog", () => {
  const config = {
    default: "claude-code" as const,
    catalog: {
      "claude-code": {
        displayName: "Claude",
        providers: ["anthropic" as const],
        tags: [],
        experimental: false,
        telemetryEnv: [],
      },
      codex: {
        displayName: "Codex",
        tags: [],
        experimental: false,
        telemetryEnv: [],
      },
    },
  };

  /** TEST_SCENARIO: Every harness runs from the default template's image, so
   * an install without that template offers none, and a harness it does not
   * offer fits no provider. */
  it("offers no harness when the install has no default template", () => {
    const catalog = createHarnessCatalog(config, false);
    expect(catalog.harnesses).toEqual([]);
    expect(harnessFits(catalog, "claude-code", "anthropic")).toBe(false);
  });

  /** TEST_SCENARIO: A listed harness fits the provider types it names, and
   * one that names none fits every type. */
  it("fits a listed harness to the providers it names", () => {
    const catalog = createHarnessCatalog(config, true);
    expect(harnessFits(catalog, "claude-code", "anthropic")).toBe(true);
    expect(harnessFits(catalog, "claude-code", "openai")).toBe(false);
    expect(harnessFits(catalog, "codex", "openai")).toBe(true);
  });
});
