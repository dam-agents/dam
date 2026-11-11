// TEST_OVERVIEW: A run always has a model, so an Agent that says hello while nothing it holds serves its harness is granted the deployment's shared CurveBender, once, and only then, and the defaults that follow are published through the transaction that read them.
import { describe, expect, it, vi } from "vitest";
import type { Db, DbTx } from "db";
import type { HarnessCatalog, ProviderCatalogView } from "api-server-api";
import { composeSharedCurveBender } from "../../modules/harness-config/compose.js";
import { createSharedCurveBenderGrant } from "../../modules/harness-config/services/shared-curvebender.js";
import type { GrantedProvider } from "../../modules/harness-config/domain/session-pair.js";
import type { ResolvedProfile } from "../../modules/profiles/index.js";

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
  ],
  telemetryEnv: () => [],
};

const ROUTED = {
  defaultHarness: "claude-code",
  modelRouter: true,
  harnesses: [{ name: "claude-code", harnessConfig: true, sessionModel: true }],
};

const listed = (
  connectionId: string,
  alias: string,
  upstreamIds: string[],
): ProviderCatalogView =>
  ({
    connectionId,
    alias,
    status: "listed",
    models: upstreamIds.map((upstreamId) => ({
      name: `${alias}/${upstreamId}`,
      upstreamId,
      harnesses: ["claude-code"],
    })),
  }) as unknown as ProviderCatalogView;

const IBM: GrantedProvider = {
  id: "lite",
  type: "ibm-litellm",
  templateId: "ibm-litellm",
};

const OWN_KEY_CURVEBENDER: GrantedProvider = {
  id: "cb-own",
  type: "curve-bender",
  templateId: "curve-bender",
};

function hello(opts?: {
  enabled?: boolean;
  capabilities?: unknown;
  granted?: GrantedProvider[];
  providers?: ProviderCatalogView[];
}) {
  const granted = vi.fn(async () => true);
  const publishDefaults = vi.fn(async () => {});
  const messages: string[] = [];
  const onHello = createSharedCurveBenderGrant({
    enabled: opts?.enabled ?? true,
    catalog: CATALOG,
    getCapabilities: async () => opts?.capabilities ?? ROUTED,
    specHarness: async () => undefined,
    ownerCatalog: async () => ({
      providers: opts?.providers ?? [],
    }),
    grantedProviders: async () => opts?.granted ?? [IBM],
    grant: granted,
    publishDefaults,
    log: (msg) => messages.push(msg),
  });
  return { onHello, granted, publishDefaults, messages };
}

describe("the shared CurveBender an Agent gets at hello", () => {
  /** TEST_SCENARIO: an Agent whose one provider has listed nothing for its harness cannot run, so a hello grants the deployment's shared CurveBender and republishes the defaults, which is how the runtime learns the model. */
  it("grants it to an agent nothing can serve", async () => {
    const h = hello();
    await h.onHello("agent-1");
    expect(h.granted).toHaveBeenCalledTimes(1);
    expect(h.publishDefaults).toHaveBeenCalledWith("agent-1");
    expect(h.messages).toEqual(["[shared-curvebender] agent-1: granted"]);
  });

  /** TEST_SCENARIO: an Agent holding a provider that lists a model for its harness already runs, so its hello grants nothing. */
  it("grants nothing when a granted provider lists a model", async () => {
    const h = hello({ providers: [listed("lite", "ibm", ["aws/opus"])] });
    await h.onHello("agent-1");
    expect(h.granted).not.toHaveBeenCalled();
    expect(h.publishDefaults).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: an Agent holding an own-key CurveBender occupies the one `cb` alias, so the shared one is never granted beside it. */
  it("grants nothing to an agent holding an own-key CurveBender", async () => {
    const h = hello({ granted: [OWN_KEY_CURVEBENDER] });
    await h.onHello("agent-1");
    expect(h.granted).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: an install that configures no deployment key has no shared provider to grant, so it does nothing even for an Agent holding no provider. */
  it("grants nothing when the deployment has no shared key", async () => {
    const h = hello({ enabled: false, granted: [] });
    await h.onHello("agent-1");
    expect(h.granted).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: the deployment's shared CurveBender reaches an Agent that already holds it only through the `cb` alias, so a second hello grants nothing and republishes nothing. */
  it("is idempotent", async () => {
    const h = hello({
      granted: [
        {
          id: "cb-shared",
          type: "curve-bender",
          templateId: "curve-bender-deployment",
        },
      ],
    });
    await h.onHello("agent-1");
    await h.onHello("agent-1");
    expect(h.granted).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a failing grant is the connections service's business, not the hello's: it is logged and a later hello tries again. */
  it("logs a failing grant and does not throw", async () => {
    const messages: string[] = [];
    const onHello = createSharedCurveBenderGrant({
      enabled: true,
      catalog: CATALOG,
      getCapabilities: async () => ROUTED,
      specHarness: async () => undefined,
      ownerCatalog: async () => ({ providers: [] }),
      grantedProviders: async () => [IBM],
      grant: async () => {
        throw new Error("db down");
      },
      publishDefaults: async () => {},
      log: (msg) => messages.push(msg),
    });
    await expect(onHello("agent-1")).resolves.toBeUndefined();
    expect(messages).toEqual(["[shared-curvebender] agent-1: db down"]);
  });
});

describe("the defaults published after the shared CurveBender is granted", () => {
  /* UNIT_BOUNDARY_DESCRIPTION: the publisher reads the agent's row and queues the event inside one transaction holding it, so the profile it names is resolved through that transaction's own connection rather than the pool's. */
  const PROFILE: ResolvedProfile = {
    profile: { name: "Pi fast" } as ResolvedProfile["profile"],
    pair: { harness: "pi", provider: null, model: null },
    unavailable: null,
    subagent: null,
    subagentUnavailable: null,
    attachable: false,
  };

  const row = {
    chat: null,
    channel: null,
    scheduled: null,
    sessionProfile: "p1",
    platformSubagentProfile: null,
    platformSubagentSettings: null,
    capabilities: ROUTED,
  };

  /* UNIT_BOUNDARY_DESCRIPTION: the two reads the reward makes, one for the profile's Connection grants and one for the agent's own row, over the builder shape those queries and the transaction take. */
  const fakeDb = () => {
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: async () => [] as unknown[],
      for: async () => [row] as unknown[],
    };
    const tx = { select: () => builder, execute: async () => [{ at: "0" }] };
    return {
      tx,
      db: {
        select: () => builder,
        transaction: (fn: (inTx: object) => Promise<unknown>) => fn(tx),
      } as unknown as Db,
    };
  };

  /** TEST_SCENARIO: a hello grants the shared CurveBender to an Agent with no provider, and the defaults republished afterwards resolve the chat default's profile through the transaction that holds the agent's row, so no second pool connection is asked for. */
  it("resolves the profile through the transaction's resolver", async () => {
    const seen: string[] = [];
    const pooled = vi.fn(async () => {
      seen.push("pooled");
      return PROFILE;
    });
    const { db, tx } = fakeDb();
    const events: unknown[] = [];
    const { grant, helloSaga } = composeSharedCurveBender({
      db,
      enabled: true,
      catalog: CATALOG,
      getCapabilities: async () => ROUTED,
      specHarness: async () => undefined,
      ownerCatalog: async () => ({ providers: [] }),
      resolveProfile: pooled,
      resolveProfileOn: (executor) => {
        seen.push(
          executor === (tx as unknown as DbTx) ? "transaction" : "other",
        );
        return async () => PROFILE;
      },
      boundary: {
        inputs: async () => ({ capabilities: ROUTED, catalog: null }),
        settle: () => ({
          pair: (pair: unknown) => pair,
          settings: () => undefined,
        }),
      } as never,
      runtimeMutator: {
        bump: async (_agentId: string, evts: unknown[]) => {
          events.push(...evts);
          return 1;
        },
        supersede: async () => {},
        enqueueAfterCommit: async () => {},
      } as never,
      grant: async () => true,
      log: () => {},
    });
    try {
      await grant("agent-1");
    } finally {
      helloSaga.unsubscribe();
    }
    expect(seen).toEqual(["transaction"]);
    expect(events).toHaveLength(1);
  });
});
