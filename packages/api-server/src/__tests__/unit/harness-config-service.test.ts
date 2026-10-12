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

type BumpCall = { agentId: string; events: unknown[] };
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
}) {
  const calls = {
    bumps: [] as BumpCall[],
    enqueues: [] as string[],
    merges: [] as MergeCall[],
    pairs: [] as SessionPair[],
  };
  const service = createHarnessConfigService({
    ownerSub: "owner-1",
    surface: "ui",
    runtimeMutator: {
      bump: async (agentId, events) => {
        calls.bumps.push({ agentId, events });
        return 1;
      },
      enqueueAfterCommit: async (agentId) => {
        calls.enqueues.push(agentId);
      },
    },
    snapshotRepo: {
      read: async () => opts?.snapshot ?? null,
      merge: async (agentId, patch, mergeOpts) => {
        calls.merges.push({ agentId, patch, confirmed: mergeOpts.confirmed });
      },
    },
    pairRepo: {
      read: async () => null,
      write: async (_agentId, pair) => {
        calls.pairs.push(pair);
      },
      grantedProviders: async () => opts?.granted ?? [],
    },
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
    isOwnedAgent: async () => opts?.owned ?? true,
    getCapabilities: async () => opts?.capabilities,
    isSettled: async () => opts?.settled ?? true,
    now: () => 1000,
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
    expect(calls.bumps).toEqual([]);
  });

  it("sends a change for a carried harness with the harness named", async () => {
    const { service, calls } = makeService({ capabilities: CARRIES_CODEX });
    await service.apply("a1", {
      harness: "codex",
      configOptions: { effort: "high" },
    });
    expect(calls.bumps[0]?.events[0]).toMatchObject({
      payload: { harness: "codex", configOptions: { effort: "high" } },
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
      service.rememberSessionPair("a1", {
        harness: "codex",
        provider: "lite",
        model: "x",
      }),
    ).rejects.toThrow(/cannot run on that provider/);
    await service.rememberSessionPair("a1", {
      harness: "codex",
      provider: "oai",
      model: "gpt-5",
    });
    expect(calls.pairs).toEqual([
      { harness: "codex", provider: "oai", model: "gpt-5" },
    ]);
  });
});

describe("harness-config service", () => {
  it("fires a one-shot harness-config event carrying the change, then enqueues", async () => {
    const { service, calls } = makeService();
    await service.apply("a1", { model: "opus", unset: ["mode"] });
    expect(calls.bumps).toHaveLength(1);
    expect(calls.bumps[0]!.agentId).toBe("a1");
    expect(calls.bumps[0]!.events).toEqual([
      {
        id: "harness-config:a1:1000",
        kind: "harness-config",
        payload: { model: "opus", unset: ["mode"] },
        expiresAt: new Date(1000 + 30 * 24 * 60 * 60 * 1000),
      },
    ]);
    expect(calls.enqueues).toEqual(["a1"]);
  });

  it("rejects apply for an agent the caller doesn't own (no event fired)", async () => {
    const { service, calls } = makeService({ owned: false });
    await expect(service.apply("a1", { model: "opus" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(calls.bumps).toHaveLength(0);
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
      defaultHarness: null,
      harnesses: null,
    });
    expect(
      await makeService({ capabilities: null }).service.status("a1"),
    ).toEqual({
      supported: true,
      catalog: null,
      sessionModel: false,
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
