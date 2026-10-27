import { describe, it, expect } from "vitest";
import type {
  HarnessConfigSnapshot,
  HarnessConfigSnapshotPatch,
  SessionPair,
} from "api-server-api";
import type { GrantedProvider } from "../../modules/harness-config/domain/session-pair.js";
import {
  createHarnessConfigService,
  sessionModelChoices,
} from "../../modules/harness-config/services/harness-config-service.js";
import { harnessConfigSupported } from "../../modules/harness-config/index.js";
import { createSessionPairRepo } from "../../modules/harness-config/infrastructure/session-pair-repo.js";
import type { ResolvedProfile } from "../../modules/profiles/index.js";

type QueueCall = { agentId: string; change: unknown; inLock: boolean };
type MergeCall = {
  agentId: string;
  patch: HarnessConfigSnapshotPatch;
  confirmed: boolean;
};

function makeService(opts?: {
  owned?: boolean;
  settled?: boolean;
  capabilities?: unknown;
  snapshot?: HarnessConfigSnapshot | null;
  granted?: GrantedProvider[];
  resolved?: SessionPair;
  profileOwner?: string;
  unavailable?: string;
  hidden?: string[];
}) {
  const calls = {
    queues: [] as QueueCall[],
    enqueues: [] as string[],
    merges: [] as MergeCall[],
    pairs: [] as SessionPair[],
    references: [] as unknown[],
    locked: 0,
    retired: [] as {
      agentId: string;
      inLock: boolean;
      harness?: string;
    }[],
  };
  let holdingLock = false;
  const service = createHarnessConfigService({
    ownerSub: "owner-1",
    resolveProfile: async ({ owner }) =>
      opts?.resolved === undefined ||
      (owner !== undefined && owner !== (opts.profileOwner ?? "owner-1"))
        ? null
        : ({
            pair: opts.resolved,
            unavailable: opts.unavailable ?? null,
          } as ResolvedProfile),
    surface: "ui",
    eventQueue: {
      queue: async (agentId, change, tx) => {
        calls.queues.push({
          agentId,
          change,
          inLock: holdingLock && tx !== undefined,
        });
        return 1;
      },
    },
    runtimeMutator: {
      bump: async () => 1,
      enqueueAfterCommit: async (agentId) => {
        calls.enqueues.push(agentId);
      },
      supersede: async () => {},
    },
    snapshotRepo: {
      read: async () => opts?.snapshot ?? null,
      merge: async (agentId, patch, mergeOpts) => {
        calls.merges.push({ agentId, patch, confirmed: mergeOpts.confirmed });
      },
      locked: async (_agentId, work) => {
        calls.locked += 1;
        holdingLock = true;
        try {
          return await work({} as never);
        } finally {
          holdingLock = false;
        }
      },
    },
    pairRepo: {
      read: async () => null,
      readSaved: async () => ({
        chat: null,
        channel: null,
        scheduled: null,
        chatProfileId: null,
      }),
      write: async (_agentId, _kind, pair, references) => {
        calls.pairs.push(pair);
        calls.references.push(references ?? {});
      },
      clear: async () => {},
      grantedProviders: async () => opts?.granted ?? [],
    },
    publishDefaults: async () => {},
    catalog: {
      default: "claude-code",
      harnesses: [
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
    retireReset: async (agentId, tx, harness) => {
      calls.retired.push({
        agentId,
        inLock: holdingLock && tx !== undefined,
        ...(harness !== undefined && { harness }),
      });
    },
    isOwnedAgent: async () => opts?.owned ?? true,
    specHarness: async () => undefined,
    getCapabilities: async () => opts?.capabilities,
    isSettled: async () => opts?.settled ?? true,
    hiddenHarnesses: async () => new Set(opts?.hidden),
  });
  return { service, calls };
}

const CARRIES_CODEX = {
  harnessConfig: true,
  defaultHarness: "claude-code",
  harnesses: [
    { name: "claude-code", harnessConfig: true, sessionModel: true },
    { name: "codex", harnessConfig: true, sessionModel: false },
  ],
};

describe("harness-config service: harnesses chosen per session", () => {
  /** TEST_SCENARIO: A harness behind an experimental feature the owner has off is left out of the harnesses offered, yet a change naming it still applies. */
  it("leaves a hidden harness out of status but still applies its change", async () => {
    const { service, calls } = makeService({
      capabilities: CARRIES_CODEX,
      hidden: ["codex"],
    });
    expect((await service.status("a1")).harnesses).toEqual([
      { name: "claude-code", harnessConfig: true, sessionModel: true },
    ]);
    await service.apply("a1", {
      harness: "codex",
      configOptions: { effort: "high" },
    });
    expect(calls.queues).toHaveLength(1);
  });

  /** TEST_SCENARIO: An agent still on an image with one harness would apply
   * Codex's settings to its own harness's file, so a change naming a harness
   * it does not report carrying is refused. */
  it("refuses a change for a harness the agent's runtime does not carry", async () => {
    const { service, calls } = makeService({
      capabilities: { harnessConfig: true },
    });
    await expect(
      service.apply("a1", {
        harness: "codex",
        configOptions: { effort: "high" },
      }),
    ).rejects.toThrow(/does not carry the codex harness/);
    expect(calls.queues).toEqual([]);
  });

  it("sends a change for a carried harness with the harness named", async () => {
    const { service, calls } = makeService({ capabilities: CARRIES_CODEX });
    await service.apply("a1", {
      harness: "codex",
      configOptions: { effort: "high" },
    });
    expect(calls.queues[0]?.change).toMatchObject({
      harness: "codex",
      configOptions: { effort: "high" },
    });
  });

  /** TEST_SCENARIO: The pair a person picks is remembered only when the
   * harness can run on the chosen provider. */
  it("remembers a pair only on a provider its harness can run on", async () => {
    const { service, calls } = makeService({
      capabilities: CARRIES_CODEX,
      granted: [
        { id: "lite", type: "ibm-litellm" },
        { id: "oai", type: "openai" },
      ],
    });
    await expect(
      service.rememberSessionPair("a1", "chat", {
        harness: "codex",
        provider: "lite",
        model: "x",
      }),
    ).rejects.toThrow(/cannot run on that provider/);
    await service.rememberSessionPair("a1", "chat", {
      harness: "codex",
      provider: "oai",
      model: "gpt-5",
    });
    expect(calls.pairs).toEqual([
      { harness: "codex", provider: "oai", model: "gpt-5" },
    ]);
  });
});

describe("harness-config service: pairs on a runtime that routes by model name", () => {
  const ROUTED = { ...CARRIES_CODEX, modelRouter: true };
  const granted: GrantedProvider[] = [
    { id: "lite", type: "ibm-litellm" },
    { id: "oai", type: "openai" },
  ];

  /** TEST_SCENARIO: A saved pair names its model with the provider; the
   * provider follows from that name, a bare name is refused, and a provider
   * the agent does not hold is refused naming the alias. */
  it("saves a qualified model with the provider it names", async () => {
    const { service, calls } = makeService({ capabilities: ROUTED, granted });
    await service.rememberSessionPair("a1", "chat", {
      harness: "codex",
      provider: null,
      model: "openai/gpt-5.5",
    });
    expect(calls.pairs).toEqual([
      { harness: "codex", provider: "oai", model: "openai/gpt-5.5" },
    ]);
    await expect(
      service.rememberSessionPair("a1", "chat", {
        harness: "codex",
        provider: "oai",
        model: "gpt-5.5",
      }),
    ).rejects.toThrow(/name the model with its provider/);
    await expect(
      service.rememberSessionPair("a1", "chat", {
        harness: "codex",
        provider: null,
        model: "cb/glm",
      }),
    ).rejects.toThrow(/holds no cb provider/);
  });

  /** TEST_SCENARIO: A routed agent's default always names a model, so the
   * platform never has to pick one: saving one without a model is refused. */
  it("refuses a default with no model", async () => {
    const { service, calls } = makeService({ capabilities: ROUTED, granted });
    await expect(
      service.rememberSessionPair("a1", "chat", {
        harness: "codex",
        provider: "oai",
        model: null,
      }),
    ).rejects.toThrow(/pick a model/);
    expect(calls.pairs).toEqual([]);
  });

  /** TEST_SCENARIO: The harness last reported its model list; a model not on
   * it is refused, one on it is saved, in Claude Code's spelling too. */
  it("refuses a model the harness's last list does not carry", async () => {
    const { service, calls } = makeService({
      capabilities: ROUTED,
      granted,
      snapshot: {
        model: null,
        mode: null,
        configOptions: {},
        availableModels: [{ value: "openai/gpt-5.5", name: "gpt-5.5" }],
        capturedAt: new Date(0).toISOString(),
        confirmed: true,
      },
    });
    await expect(
      service.rememberSessionPair("a1", "chat", {
        harness: "codex",
        provider: null,
        model: "openai/gpt-4",
      }),
    ).rejects.toThrow(/does not list openai\/gpt-4/);
    await service.rememberSessionPair("a1", "chat", {
      harness: "codex",
      provider: null,
      model: "openai/gpt-5.5",
    });
    expect(calls.pairs[0]?.model).toBe("openai/gpt-5.5");
  });
});

describe("harness-config service", () => {
  it("fires a one-shot harness-config event carrying the change, then enqueues", async () => {
    const { service, calls } = makeService();
    await service.apply("a1", { model: "opus", unset: ["mode"] });
    expect(calls.queues).toEqual([
      {
        agentId: "a1",
        change: { model: "opus", unset: ["mode"] },
        inLock: true,
      },
    ]);
    expect(calls.merges).toHaveLength(1);
    expect(calls.enqueues).toEqual(["a1"]);
  });

  // TEST_SCENARIO: an owner who chooses a mode outranks a pending one-off correction, so the choice retires it in the same locked transaction; a runtime report of the old mode arriving afterwards cannot bring the correction back. A change that carries no mode leaves the correction alone for its pass to finish, and the choice names the harness it is about, so the retirement can be scoped to the harness the correction repairs.
  it("retires a pending reset only for a mode choice on the harness it repairs", async () => {
    const chosen = makeService({ capabilities: CARRIES_CODEX });
    await chosen.service.apply("a1", { harness: "claude-code", mode: "plan" });
    const unset = makeService();
    await unset.service.apply("a1", { unset: ["mode"] });
    const modelOnly = makeService();
    await modelOnly.service.apply("a1", { model: "opus" });
    const otherHarness = makeService({ capabilities: CARRIES_CODEX });
    await otherHarness.service.apply("a1", {
      harness: "codex",
      mode: "read-only",
    });
    const otherHarnessUnset = makeService({ capabilities: CARRIES_CODEX });
    await otherHarnessUnset.service.apply("a1", {
      harness: "codex",
      unset: ["mode"],
    });

    expect(chosen.calls.retired).toEqual([
      { agentId: "a1", inLock: true, harness: "claude-code" },
    ]);
    expect(chosen.calls.queues[0]?.inLock).toBe(true);
    expect(unset.calls.retired).toEqual([{ agentId: "a1", inLock: true }]);
    expect(modelOnly.calls.retired).toEqual([]);
    expect(otherHarness.calls.retired).toEqual([
      { agentId: "a1", inLock: true, harness: "codex" },
    ]);
    expect(otherHarnessUnset.calls.retired).toEqual([
      { agentId: "a1", inLock: true, harness: "codex" },
    ]);
  });

  it("rejects apply for an agent the caller doesn't own (no event fired)", async () => {
    const { service, calls } = makeService({ owned: false });
    await expect(service.apply("a1", { model: "opus" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(calls.queues).toHaveLength(0);
    expect(calls.enqueues).toHaveLength(0);
  });

  it("rejects settled for an agent the caller doesn't own", async () => {
    const { service } = makeService({ owned: false });
    await expect(service.settled("a1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("status maps the agent's advertised harnessConfig capability", async () => {
    expect(
      await makeService({
        capabilities: { harnessConfig: true },
      }).service.status("a1"),
    ).toEqual({
      supported: true,
      catalog: null,
      sessionModel: false,
      modelRouter: false,
      followsDefaults: false,
      defaultHarness: null,
      harnesses: null,
    });
    expect(
      await makeService({
        capabilities: { harnessConfig: false },
      }).service.status("a1"),
    ).toEqual({
      supported: false,
      catalog: null,
      sessionModel: false,
      modelRouter: false,
      followsDefaults: false,
      defaultHarness: null,
      harnesses: null,
    });
    expect(
      await makeService({ capabilities: null }).service.status("a1"),
    ).toEqual({
      supported: true,
      catalog: null,
      sessionModel: false,
      modelRouter: false,
      followsDefaults: false,
      defaultHarness: null,
      harnesses: null,
    });
  });

  it("status returns the option catalog advertised on hello", async () => {
    const catalog = {
      options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          choices: [{ value: "sonnet", name: "Sonnet" }],
        },
      ],
    };
    expect(
      await makeService({
        capabilities: { harnessConfig: true, harnessConfigCatalog: catalog },
      }).service.status("a1"),
    ).toEqual({
      supported: true,
      catalog,
      sessionModel: false,
      modelRouter: false,
      followsDefaults: false,
      defaultHarness: null,
      harnesses: null,
    });
  });

  it("rejects status for an agent the caller doesn't own", async () => {
    const { service } = makeService({ owned: false });
    await expect(service.status("a1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("harnessConfigSupported", () => {
  it("treats unknown capabilities as supported (agent not booted yet)", () => {
    expect(harnessConfigSupported(null)).toBe(true);
    expect(harnessConfigSupported(undefined)).toBe(true);
  });

  it("is true only when the agent advertises the harnessConfig flag", () => {
    expect(harnessConfigSupported({ harnessConfig: true })).toBe(true);
    expect(harnessConfigSupported({ harnessConfig: false })).toBe(false);
    expect(harnessConfigSupported({ contributions: [], events: [] })).toBe(
      false,
    );
  });
});

describe("sessionModelChoices", () => {
  const capabilities = {
    sessionModel: true,
    harnessConfigCatalog: {
      options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          choices: [{ value: "sonnet", name: "Sonnet" }],
        },
      ],
    },
  };

  // TEST_SCENARIO: an agent on a gateway such as LiteLLM lists its real models only through discovery, so a one-time task must accept what the Config panel offers rather than the static tiers alone.
  it("offers the discovered models when the provider listed any", () => {
    expect(
      sessionModelChoices(capabilities, [{ value: "claude/haiku-x" }]),
    ).toEqual(["claude/haiku-x"]);
    expect(sessionModelChoices(capabilities, null)).toEqual(["sonnet"]);
  });
});

describe("rememberSessionPair naming a profile", () => {
  const resolvedPair = {
    harness: "claude-code",
    provider: "conn-1",
    model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  };

  it("writes the reference and the pair it resolves to", async () => {
    const { service, calls } = makeService({
      granted: [{ id: "conn-1", type: "openai" }],
      capabilities: {
        modelRouter: true,
        defaultHarness: "codex",
        harnesses: [
          {
            name: "codex",
            harnessConfig: true,
            sessionModel: true,
            sessionSettings: [],
          },
        ],
      },
      resolved: {
        harness: "codex",
        provider: "conn-1",
        model: "openai/gpt-6.1-sol",
      },
    });
    const pair = {
      harness: "codex",
      provider: "conn-1",
      model: "openai/gpt-6.1-sol",
    };
    await service.rememberSessionPair("agent-1", "chat", pair, {
      profileId: "profile-1",
    });
    expect(calls.pairs).toEqual([pair]);
    expect(calls.references).toEqual([{ profileId: "profile-1" }]);
  });

  it("refuses a profile that cannot run on the agent", async () => {
    const { service, calls } = makeService({
      resolved: {
        harness: "codex",
        provider: "conn-1",
        model: "openai/gpt-6.1-sol",
      },
      unavailable: "CurveBender (shared) is not connected",
    });
    await expect(
      service.rememberSessionPair("agent-1", "chat", resolvedPair, {
        profileId: "profile-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "CurveBender (shared) is not connected",
    });
    expect(calls.pairs).toEqual([]);
  });

  it("refuses a profile named for a kind that keeps its own", async () => {
    const { service } = makeService({});
    await expect(
      service.rememberSessionPair("agent-1", "scheduled", resolvedPair, {
        profileId: "profile-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "only the chat default can name a profile",
    });
  });
});

describe("ownership of a profile a caller names", () => {
  const codexPair = {
    harness: "codex",
    provider: "conn-1",
    model: "openai/gpt-6.1-sol",
  };
  const carrying = {
    modelRouter: true,
    defaultHarness: "codex",
    harnesses: [
      {
        name: "codex",
        harnessConfig: true,
        sessionModel: true,
        sessionSettings: [],
        platformSubagentSettings: true,
      },
    ],
  };

  it("refuses another owner's profile in the chat slot", async () => {
    const { service, calls } = makeService({
      capabilities: carrying,
      granted: [{ id: "conn-1", type: "openai" }],
      resolved: codexPair,
      profileOwner: "owner-2",
    });
    await expect(
      service.rememberSessionPair("agent-1", "chat", codexPair, {
        profileId: "profile-1",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "profile not found",
    });
    expect(calls.pairs).toEqual([]);
  });

  it("takes only the harness and model of the slot's profile", async () => {
    const { service, calls } = makeService({
      capabilities: carrying,
      granted: [{ id: "conn-1", type: "openai" }],
      resolved: codexPair,
    });
    await service.rememberSessionPair("agent-1", "chat", codexPair, {
      platformSubagentProfileId: "profile-1",
    });
    expect(calls.pairs[0]?.settings).toEqual({
      "platformSubagent.harness": "codex",
      "platformSubagent.model": "openai/gpt-6.1-sol",
    });
  });
});

describe("the chat default's slots", () => {
  const codexPair = {
    harness: "codex",
    provider: "conn-1",
    model: "openai/gpt-6.1-sol",
  };
  const capabilities = {
    modelRouter: true,
    defaultHarness: "codex",
    harnesses: [
      {
        name: "codex",
        harnessConfig: true,
        sessionModel: true,
        sessionSettings: ["mode"],
        platformSubagentSettings: true,
        harnessConfigCatalog: {
          options: [
            {
              id: "mode",
              name: "Mode",
              category: "mode",
              choices: [
                { value: "auto", name: "Auto" },
                { value: "bypassPermissions", name: "Bypass" },
              ],
            },
          ],
        },
      },
    ],
  };

  /** TEST_SCENARIO: a profile primary with a custom subagent keeps the subagent's values beside the reference (D124), and the session's tool approval is never saved (approval is per session only). */
  it("keeps a custom subagent beside a profile and drops tool approval", async () => {
    const { service, calls } = makeService({
      capabilities,
      granted: [{ id: "conn-1", type: "openai" }],
      resolved: codexPair,
    });
    await service.rememberSessionPair(
      "agent-1",
      "chat",
      {
        ...codexPair,
        settings: {
          mode: "bypassPermissions",
          "platformSubagent.harness": "codex",
          "platformSubagent.model": "openai/gpt-6-luna",
        },
      },
      { profileId: "profile-1", platformSubagentProfileId: null },
    );
    await service.rememberSessionPair(
      "agent-1",
      "chat",
      { ...codexPair, settings: { mode: "bypassPermissions" } },
      { platformSubagentProfileId: null },
    );
    expect(calls.pairs.map((p) => p.settings)).toEqual([
      {
        "platformSubagent.harness": "codex",
        "platformSubagent.model": "openai/gpt-6-luna",
      },
      undefined,
    ]);
  });

  /** TEST_SCENARIO: while the chat profile cannot run, the saved chat default is none, yet the view still names the subagent slot as stored, so the picker shows the custom pick it holds rather than Let the agent pick (QA N3). */
  it("names the stored subagent slot while the chat profile cannot run", async () => {
    const slot = {
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "bedrock/haiku",
    };
    const row = {
      chat: null,
      channel: null,
      scheduled: null,
      sessionProfile: "profile-1",
      platformSubagentProfile: null,
      platformSubagentSettings: slot,
      capabilities: null,
    };
    const db = {
      select: () => ({ from: () => ({ where: async () => [row] }) }),
    } as never;
    const repo = createSessionPairRepo(
      db,
      async () =>
        ({
          profile: { name: "Opus" },
          pair: null,
          unavailable: "AWS Bedrock isn't attached to this agent",
        }) as never,
    );
    expect(await repo.readSaved("agent-1")).toMatchObject({
      chat: null,
      chatProfileId: "profile-1",
      platformSubagentProfileId: null,
      platformSubagentSettings: slot,
    });
  });
});
