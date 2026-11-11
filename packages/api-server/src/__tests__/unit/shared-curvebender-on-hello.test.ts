// TEST_OVERVIEW: A run always has a model, so an Agent that says hello while nothing it holds lists a model for its harness is granted the deployment's shared CurveBender, once, and only then; the model it can run on is read from the same live catalog view the default conversion reads, so a provider that has not listed yet counts as nothing.
import { describe, expect, it, vi } from "vitest";
import type { HarnessCatalogView } from "agent-runtime-api";
import type { HarnessCatalog } from "api-server-api";
import { createSharedCurveBenderGrant } from "../../modules/harness-config/services/shared-curvebender.js";
import type { GrantedProvider } from "../../modules/harness-config/domain/session-pair.js";

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
): HarnessCatalogView["providers"][number] => ({
  connectionId,
  alias,
  template: "ibm-litellm",
  displayName: alias,
  status: "listed",
  listedAt: "2026-11-11T00:00:00.000Z",
  native: false,
  models: upstreamIds.map((upstreamId) => ({
    name: `${alias}/${upstreamId}`,
    upstreamId,
    contextWindow: null,
    maxOutputTokens: null,
    reasoning: null,
    vision: null,
    prices: null,
    source: { limits: "none", prices: "none" },
  })),
});

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

const SHARED_CURVEBENDER: GrantedProvider = {
  id: "cb-shared",
  type: "curve-bender",
  templateId: "curve-bender-deployment",
};

function hello(opts?: {
  enabled?: boolean;
  capabilities?: unknown;
  granted?: GrantedProvider[];
  view?: HarnessCatalogView | null;
  viewFails?: boolean;
}) {
  const granted = vi.fn(async () => true);
  const publishDefaults = vi.fn(async () => {});
  const messages: string[] = [];
  const onHello = createSharedCurveBenderGrant({
    enabled: opts?.enabled ?? true,
    catalog: CATALOG,
    getCapabilities: async () => opts?.capabilities ?? ROUTED,
    specHarness: async () => undefined,
    catalogView: async () =>
      opts?.viewFails
        ? Promise.reject(new Error("the pod is not up"))
        : (opts?.view ?? {
            harness: "claude-code",
            routed: true,
            providers: [],
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
    const h = hello({
      view: {
        harness: "claude-code",
        routed: true,
        providers: [listed("lite", "ibm", [])],
      },
    });
    await h.onHello("agent-1");
    expect(h.granted).toHaveBeenCalledTimes(1);
    expect(h.publishDefaults).toHaveBeenCalledWith("agent-1");
    expect(h.messages).toEqual(["[shared-curvebender] agent-1: granted"]);
  });

  /** TEST_SCENARIO: an Agent holding a provider that lists a model for its harness already runs, so its hello grants nothing. */
  it("grants nothing when a granted provider lists a model", async () => {
    const h = hello({
      view: {
        harness: "claude-code",
        routed: true,
        providers: [listed("lite", "ibm", ["aws/claude-opus-4-8"])],
      },
    });
    await h.onHello("agent-1");
    expect(h.granted).not.toHaveBeenCalled();
    expect(h.publishDefaults).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a provider that has not listed yet reads like a failed one, so the Agent is granted the shared CurveBender as well; its own provider still comes first once it lists. */
  it("grants it while a granted provider has not listed yet", async () => {
    const h = hello({ viewFails: true });
    await h.onHello("agent-1");
    expect(h.granted).toHaveBeenCalledTimes(1);
  });

  /** TEST_SCENARIO: a listing from a provider the Agent does not hold cannot serve its run, so it does not count as usable and the hello grants. */
  it("grants it when only an ungranted provider lists a model", async () => {
    const h = hello({
      view: {
        harness: "claude-code",
        routed: true,
        providers: [listed("other", "anth", ["claude-opus-5-5"])],
      },
    });
    await h.onHello("agent-1");
    expect(h.granted).toHaveBeenCalledTimes(1);
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
    const h = hello({ granted: [SHARED_CURVEBENDER] });
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
      catalogView: async () => ({
        harness: "claude-code",
        routed: true,
        providers: [],
      }),
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
