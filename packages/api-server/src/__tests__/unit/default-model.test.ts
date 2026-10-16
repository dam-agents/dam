// TEST_OVERVIEW: an Agent's saved default is never guessed. A fire on an Agent with no default model fails with a reason, and an Agent from before per-session defaults gets its default converted once, only from what is certain about it.
import { describe, expect, it } from "vitest";
import type { HarnessCatalogView } from "agent-runtime-api";
import type { HarnessCatalog, SessionPair } from "api-server-api";
import { convertedDefaultModel } from "../../modules/harness-config/domain/default-conversion.js";
import { NoDefaultModelError } from "../../modules/harness-config/domain/no-default-model.js";
import { createDefaultConverter } from "../../modules/harness-config/services/default-conversion.js";
import { createScheduleModelForFire } from "../../modules/harness-config/services/schedule-model.js";
import {
  resolveFirePair,
  resolveRememberedPair,
} from "../../modules/harness-config/services/harness-config-service.js";

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
  harnesses: [
    {
      name: "claude-code",
      harnessConfig: true,
      sessionModel: true,
      sessionSettings: ["mode"],
    },
  ],
};

const ANTHROPIC = {
  id: "anth",
  type: "anthropic" as const,
  templateId: "anthropic",
};
const IBM = {
  id: "lite",
  type: "ibm-litellm" as const,
  templateId: "ibm-litellm",
};

describe("a fire on an Agent with no default model", () => {
  const deps = (saved: SessionPair | null) => ({
    pairRepo: {
      read: async () => saved,
      write: async () => {},
      grantedProviders: async () => [ANTHROPIC],
    },
    catalog: CATALOG,
    specHarness: async () => undefined,
    getCapabilities: async () => ROUTED,
  });

  // TEST_SCENARIO: nothing is saved, so no provider or model is the person's choice; the fire fails with the reason instead of running on one the platform picked.
  it("fails with the missing default instead of guessing one", async () => {
    await expect(resolveFirePair(deps(null), "a", {})).rejects.toBeInstanceOf(
      NoDefaultModelError,
    );
  });

  // TEST_SCENARIO: the person's view of the default shows it as not set rather than failing, so the UI can ask for one.
  it("reads as not set for the person", async () => {
    expect(await resolveRememberedPair(deps(null), "a")).toEqual({
      harness: "claude-code",
      provider: null,
      model: null,
    });
  });

  // TEST_SCENARIO: a schedule that names its own model runs on it, whatever the saved default holds.
  it("runs a schedule on the model it names", async () => {
    expect(
      await resolveFirePair(deps(null), "a", {
        model: "anthropic/claude-opus-5-5",
      }),
    ).toEqual({
      harness: "claude-code",
      provider: "anth",
      model: "anthropic/claude-opus-5-5",
    });
  });
});

describe("convertedDefaultModel", () => {
  const LISTED = [
    "claude-haiku-4-5-20251001",
    "claude-opus-4-8",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
  ];
  const convert = (setting: string | null, ran: string[] = []) =>
    convertedDefaultModel({ setting, alias: "anthropic", listed: LISTED, ran });

  // TEST_SCENARIO: a tier word, as Claude Code's settings hold it, is the provider's newest model of exactly that tier.
  it("takes the newest model of the tier", () => {
    expect(convert("opus[1m]")).toBe("anthropic/claude-opus-5-5");
    expect(convert("claude/sonnet")).toBe("anthropic/claude-sonnet-5-5");
  });

  // TEST_SCENARIO: a provider with no model of the tier gets no other tier in its place, so the owner picks.
  it("takes no other tier when the provider has none of it", () => {
    expect(
      convertedDefaultModel({
        setting: "opus",
        alias: "ibm",
        listed: ["aws/claude-sonnet-5-5"],
        ran: [],
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: a model id is kept in the provider's own spelling when the provider lists it, and dropped when it does not.
  it("keeps a listed model id and drops an unlisted one", () => {
    expect(convert("Claude-Opus-4-8")).toBe("anthropic/claude-opus-4-8");
    expect(convert("anthropic/claude-opus-4-8")).toBe(
      "anthropic/claude-opus-4-8",
    );
    expect(convert("claude-opus-3")).toBeNull();
  });

  // TEST_SCENARIO: the harness's own default is the model the Agent's calls mostly ran, the first one the provider still lists.
  it("takes the model the agent ran for the harness default", () => {
    expect(convert("default", ["claude-opus-3", "claude-opus-4-8"])).toBe(
      "anthropic/claude-opus-4-8",
    );
    expect(convert(null, ["claude/claude-sonnet-5-5"])).toBe(
      "anthropic/claude-sonnet-5-5",
    );
    expect(convert("default", [])).toBeNull();
  });
});

describe("convertedDefaultModel on a provider that prefixes its ids", () => {
  // TEST_SCENARIO: Claude Code on IBM records a call's model without IBM's route prefix, so the harness default matches the one listed id ending in that name, and none when two routes list it.
  it("matches the recorded name to the one listed id ending in it", () => {
    const convert = (listed: string[]) =>
      convertedDefaultModel({
        setting: null,
        alias: "ibm",
        listed,
        ran: ["claude-sonnet-5-5"],
      });
    expect(convert(["aws/claude-sonnet-5-5", "aws/claude-opus-5-5"])).toBe(
      "ibm/aws/claude-sonnet-5-5",
    );
    expect(
      convert(["aws/claude-sonnet-5-5", "gcp/claude-sonnet-5-5"]),
    ).toBeNull();
  });
});

describe("the one-time default conversion", () => {
  const view = (
    status: "listed" | "unavailable" | "unsupported",
    models: string[],
  ): HarnessCatalogView => ({
    harness: "claude-code",
    routed: true,
    providers: [
      {
        connectionId: "anth",
        alias: "anthropic",
        template: "anthropic",
        displayName: "Anthropic",
        status,
        listedAt: null,
        native: false,
        models: models.map((upstreamId) => ({
          name: `claude/anthropic/${upstreamId}`,
          upstreamId,
        })) as never,
      },
    ],
  });

  const converter = (opts: {
    saved?: SessionPair | null;
    granted?: (typeof ANTHROPIC | typeof IBM)[];
    capabilities?: unknown;
    catalog?: HarnessCatalogView | null;
    setting?: string | null;
    ran?: string[];
    moved?: boolean;
    running?: boolean;
    helloAfterWake?: boolean;
  }) => {
    const writes: SessionPair[] = [];
    let saved = opts.saved ?? null;
    const ranQueries: number[] = [];
    const wakes: string[] = [];
    let catalogReads = 0;
    let moved = opts.moved ?? false;
    let clock = 0;
    const c = createDefaultConverter({
      pairRepo: {
        read: async () => saved,
        write: async () => {},
        writeIfEmpty: async (_id, pair) => {
          if (saved) return false;
          saved = pair;
          writes.push(pair);
          return true;
        },
        grantedProviders: async () => (opts.granted ?? [ANTHROPIC]) as never,
      },
      snapshotRepo: {
        read: async () =>
          ({
            model: opts.setting === undefined ? "opus[1m]" : opts.setting,
          }) as never,
        merge: async () => {},
      },
      catalog: CATALOG,
      getCapabilities: async () => opts.capabilities ?? ROUTED,
      specHarness: async () => undefined,
      catalogView: async () => {
        catalogReads++;
        return opts.catalog === undefined
          ? view("listed", ["claude-opus-4-8", "claude-opus-5-5"])
          : opts.catalog;
      },
      modelsRanBy: async (_id, hours) => {
        ranQueries.push(hours);
        return hours >= 7 * 24 ? (opts.ran ?? []) : [];
      },
      movedToNewImage: async () => moved,
      isRunning: async () => opts.running ?? true,
      wake: async (id) => {
        wakes.push(id);
        if (opts.helloAfterWake !== false) moved = false;
        return { previous: "T0", written: "T1" };
      },
      lastHelloAt: async () =>
        opts.helloAfterWake === false ? 0 : Number.MAX_SAFE_INTEGER,
      now: () => (clock += 60_000),
      log: () => {},
      sleep: async () => {},
    });
    return { c, writes, ranQueries, wakes, catalogReads: () => catalogReads };
  };

  // TEST_SCENARIO: an Agent from v0.2.21 holds one provider and a tier setting, so its default becomes that provider's newest model of the tier, saved once.
  it("saves the converted default once", async () => {
    const { c, writes } = converter({});
    expect(await c.convert("a")).toBe("converted");
    expect(await c.convert("a")).toBe("saved");
    expect(writes).toEqual([
      {
        harness: "claude-code",
        provider: "anth",
        model: "anthropic/claude-opus-5-5",
      },
    ]);
  });

  // TEST_SCENARIO: several providers fit, and nothing says which one the person meant, so the default is saved as not set for the owner to pick.
  it("saves not set when several providers fit", async () => {
    const { c, writes } = converter({ granted: [ANTHROPIC, IBM] });
    expect(await c.convert("a")).toBe("not-set");
    expect(writes).toEqual([
      { harness: "claude-code", provider: null, model: null },
    ]);
  });

  // TEST_SCENARIO: the provider has not listed its models yet, so nothing is decided or saved; a later try converts.
  it("waits while the provider has not listed", async () => {
    const { c, writes } = converter({ catalog: view("unavailable", []) });
    expect(await c.convert("a")).toBe("waiting");
    expect(writes).toEqual([]);
  });

  // TEST_SCENARIO: an Agent still on a runtime without the Model Router keeps today's path and is not converted.
  it("leaves an Agent on an older runtime alone", async () => {
    const { c, writes } = converter({ capabilities: {} });
    expect(await c.convert("a")).toBe("old-runtime");
    expect(writes).toEqual([]);
  });

  // TEST_SCENARIO: the harness default reads telemetry from the narrowest window that has calls, never more.
  it("reads telemetry only for the harness default, narrowest window first", async () => {
    const tier = converter({});
    await tier.c.convert("a");
    expect(tier.ranQueries).toEqual([]);

    const harnessDefault = converter({
      setting: "default",
      ran: ["claude-opus-4-8"],
    });
    expect(await harnessDefault.c.convert("a")).toBe("converted");
    expect(harnessDefault.ranQueries).toEqual([24, 7 * 24]);
    expect(harnessDefault.writes[0]?.model).toBe("anthropic/claude-opus-4-8");
  });

  // TEST_SCENARIO: a provider unsupported only because an older runtime's env names no template for it is no evidence the model is gone, so nothing is decided; one the runtime refuses for the harness (the subscription on Pi) is saved as not set rather than left pending for good.
  it("waits on an untagged provider and saves not set on a refused one", async () => {
    const untagged = view("unsupported", []);
    untagged.providers[0]!.template = "";
    const waiting = converter({ catalog: untagged });
    expect(await waiting.c.convert("a")).toBe("waiting");
    expect(waiting.writes).toEqual([]);

    const refused = converter({ catalog: view("unsupported", []) });
    expect(await refused.c.convert("a")).toBe("not-set");
    expect(refused.writes[0]?.model).toBeNull();
  });

  // TEST_SCENARIO: a fire wakes an Agent first only while it is moved to a new image and asleep, so the fire is checked against the new runtime; its start ends the move, so a later fire takes the normal order.
  it("wakes first only an agent moved to a new image and asleep", async () => {
    const notMoved = converter({ moved: false, running: false });
    expect(await notMoved.c.ensureForFire("a")).toBeNull();
    expect(notMoved.wakes).toEqual([]);
    expect(notMoved.writes).toEqual([]);

    const moved = converter({ moved: true, running: false });
    expect(await moved.c.ensureForFire("a")).toEqual({
      previous: "T0",
      written: "T1",
    });
    expect(moved.wakes).toEqual(["a"]);
    expect(moved.writes[0]?.model).toBe("anthropic/claude-opus-5-5");
    expect(await moved.c.ensureForFire("a")).toBeNull();
    expect(moved.wakes).toEqual(["a"]);

    const savedAlready = converter({
      moved: true,
      running: false,
      saved: { harness: "claude-code", provider: "anth", model: "x/y" },
    });
    await savedAlready.c.ensureForFire("a");
    expect(savedAlready.wakes).toEqual(["a"]);
    expect(savedAlready.writes).toEqual([]);
  });

  // TEST_SCENARIO: a moved Agent whose new runtime does not say hello in time fails the fire as still setting up, rather than letting it go out on the old runtime's view.
  it("fails the fire as pending when the moved agent does not start in time", async () => {
    const slow = converter({
      moved: true,
      running: false,
      helloAfterWake: false,
    });
    await expect(slow.c.ensureForFire("a")).rejects.toMatchObject({
      name: "NoDefaultModelError",
      pending: true,
    });
  });

  // TEST_SCENARIO: a hello, a fire and a channel turn arriving together share one conversion instead of each polling the runtime.
  it("shares one conversion between callers", async () => {
    const { c, catalogReads } = converter({});
    await Promise.all([c.ensure("a", 1000), c.ensure("a", 1000)]);
    expect(catalogReads()).toBe(1);
  });
});

describe("a schedule model on a runtime that takes none per session", () => {
  const forFire = (capabilities: unknown, own: string | null) =>
    createScheduleModelForFire({
      getCapabilities: async () => capabilities,
      snapshotRepo: {
        read: async () => ({ model: own }) as never,
        merge: async () => {},
      },
    });

  // TEST_SCENARIO: the upgrade copied a v0.2.21 agent's own model onto its schedules; that runtime cannot take a model per session, so the fire drops the copy and runs as before, while a schedule naming another model still goes to the check that refuses it.
  it("drops the agent's own model and keeps any other", async () => {
    const legacy = forFire({}, "aws/claude-opus-4-8");
    expect(await legacy("a", "ibm/aws/claude-opus-4-8")).toBeUndefined();
    expect(await forFire({}, "opus[1m]")("a", "bedrock/opus")).toBeUndefined();
    expect(await legacy("a", "ibm/aws/claude-sonnet-5-5")).toBe(
      "ibm/aws/claude-sonnet-5-5",
    );
    expect(
      await forFire(ROUTED, "aws/claude-opus-4-8")(
        "a",
        "ibm/aws/claude-opus-4-8",
      ),
    ).toBe("ibm/aws/claude-opus-4-8");
  });
});
