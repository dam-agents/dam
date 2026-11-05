// TEST_OVERVIEW: an Agent's saved default is never guessed. A fire on an Agent with nothing saved runs on the automatic model of its providers and fails only when none lists a model, and an Agent from before per-session defaults gets its default converted once, only from what is certain about it.
import { describe, expect, it } from "vitest";
import type { HarnessCatalogView } from "agent-runtime-api";
import type {
  HarnessCatalog,
  ProviderCatalogView,
  SessionPair,
} from "api-server-api";
import { convertedDefault } from "../../modules/harness-config/domain/converted-default.js";
import { convertedDefaultModel } from "../../modules/harness-config/domain/default-conversion.js";
import { defaultModelNoticesOf } from "../../modules/harness-config/domain/default-model-notice.js";
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

const nothingSaved = {
  chat: null,
  channel: null,
  scheduled: null,
  chatProfileId: null,
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

describe("a fire on an Agent with no default model", () => {
  const deps = (
    saved: SessionPair | null,
    providers: ProviderCatalogView[] = [
      listed("anth", "anthropic", ["claude-sonnet-5-5", "claude-opus-5-5"]),
    ],
    chatProfileId: string | null = null,
  ) => ({
    pairRepo: {
      read: async () => saved,
      readSaved: async () => ({ ...nothingSaved, chatProfileId }),
      write: async () => {},
      grantedProviders: async () => [ANTHROPIC, IBM],
    },
    catalog: CATALOG,
    specHarness: async () => undefined,
    getCapabilities: async () => ROUTED,
    ownerCatalog: async () => ({ providers }),
  });

  // TEST_SCENARIO: nothing is saved, yet the agent holds a provider that lists models; the fire runs on the platform's preferred model for the harness there instead of failing for lack of a saved default — Claude where a provider serves it, which is what a Claude Code agent gets even beside a provider that lists DeepSeek.
  it("runs on the automatic model", async () => {
    expect(await resolveFirePair(deps(null), "a", "scheduled", {})).toEqual({
      harness: "claude-code",
      provider: "anth",
      model: "anthropic/claude-opus-5-5",
    });
    expect(
      await resolveFirePair(
        deps(null, [
          listed("cb", "cb", ["rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"]),
          listed("anth", "anthropic", ["claude-opus-5-5"]),
        ]),
        "a",
        "scheduled",
        {},
      ),
    ).toEqual({
      harness: "claude-code",
      provider: "anth",
      model: "anthropic/claude-opus-5-5",
    });
  });

  // TEST_SCENARIO: no provider lists a preferred model, so the run takes the first model the first provider lists rather than fail.
  it("falls back to the first listed model", async () => {
    expect(
      await resolveFirePair(
        deps(null, [listed("lite", "ibm", ["aws/claude-haiku-4-5"])]),
        "a",
        "scheduled",
        {},
      ),
    ).toMatchObject({ provider: "lite", model: "ibm/aws/claude-haiku-4-5" });
  });

  // TEST_SCENARIO: a "not set" default names its provider, so the automatic model comes from that provider even where another one lists the preferred model.
  it("keeps a not-set default on its provider", async () => {
    expect(
      await resolveFirePair(
        deps({ harness: "claude-code", provider: "lite", model: null }, [
          listed("anth", "anthropic", ["claude-opus-5-5"]),
          listed("lite", "ibm", ["aws/claude-sonnet-5-5"]),
        ]),
        "a",
        "scheduled",
        {},
      ),
    ).toMatchObject({ provider: "lite", model: "ibm/aws/claude-sonnet-5-5" });
  });

  // TEST_SCENARIO: a "not set" default whose provider the agent no longer holds pins nothing, so the run takes the automatic model of the providers it does hold, as the defaults the runtime follows do.
  it("drops a not-set pin to a provider the agent no longer holds", async () => {
    expect(
      await resolveFirePair(
        deps({ harness: "claude-code", provider: "gone", model: null }),
        "a",
        "scheduled",
        {},
      ),
    ).toMatchObject({ provider: "anth", model: "anthropic/claude-opus-5-5" });
  });

  // TEST_SCENARIO: the chat default names a profile that cannot run here, which reads as no default; it is the owner's choice, so the fire is refused rather than run on the automatic model, and the person's view shows no model.
  it("refuses a chat profile that cannot run instead of replacing it", async () => {
    const refused = deps(null, undefined, "profile-1");
    await expect(
      resolveFirePair(refused, "a", "scheduled", {}),
    ).rejects.toThrow(/profile this agent's default names cannot run/);
    expect(await resolveRememberedPair(refused, "a", "chat")).toMatchObject({
      model: null,
    });
  });

  // TEST_SCENARIO: the only failure left is an agent whose providers list nothing it can run; the reason says to connect a model provider, not to pick a model.
  it("fails as having no model provider when none lists a model", async () => {
    await expect(
      resolveFirePair(deps(null, []), "a", "scheduled", {}),
    ).rejects.toThrow(/connect a model provider/);
  });

  // TEST_SCENARIO: a saved model whose provider is gone is the person's choice, so it is never replaced; the reason names the model.
  it("never replaces a saved model whose provider is gone", async () => {
    await expect(
      resolveFirePair(
        deps({
          harness: "claude-code",
          provider: null,
          model: "openai/gpt-6-1-sol",
        }),
        "a",
        "scheduled",
        {},
      ),
    ).rejects.toThrow(
      /no provider this agent holds serves openai\/gpt-6-1-sol/,
    );
  });

  // TEST_SCENARIO: the person's view of the default shows the model a run takes, so "Default" names it.
  it("reads as the automatic model for the person", async () => {
    expect(await resolveRememberedPair(deps(null), "a", "chat")).toEqual({
      harness: "claude-code",
      provider: "anth",
      model: "anthropic/claude-opus-5-5",
    });
  });

  // TEST_SCENARIO: a schedule that names its own model runs on it, whatever the saved default holds.
  it("runs a schedule on the model it names", async () => {
    expect(
      await resolveFirePair(deps(null), "a", "scheduled", {
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
    convertedDefaultModel({
      harness: "claude-code",
      setting,
      providers: [{ alias: "anthropic", listed: LISTED }],
      ran,
    });

  // TEST_SCENARIO: a tier word, as Claude Code's settings hold it, is the provider's newest model of exactly that tier.
  it("takes the newest model of the tier", () => {
    expect(convert("opus[1m]")).toBe("anthropic/claude-opus-5-5");
    expect(convert("claude/sonnet")).toBe("anthropic/claude-sonnet-5-5");
  });

  // TEST_SCENARIO: a kit names the model its Agent must run on whatever provider serves it, so a declared model wins over the image's tier setting when the provider lists it, under its own name or as the one id ending in it; a declared model this provider does not list falls back to the tier, so the kit's pin never becomes a call that fails.
  it("takes the model the kit declared where the provider lists it", () => {
    const ibm = (declared: string, listed: string[]) =>
      convertedDefaultModel({
        harness: "claude-code",
        setting: "opus",
        providers: [{ alias: "ibm", listed }],
        ran: [],
        declared,
      });
    expect(ibm("claude-opus-5", ["aws/claude-sonnet-5-5"])).toBeNull();
    expect(
      ibm("claude-opus-5", ["aws/claude-opus-5-5", "aws/claude-opus-5"]),
    ).toBe("ibm/aws/claude-opus-5");
    expect(
      convertedDefaultModel({
        harness: "claude-code",
        setting: "opus",
        providers: [{ alias: "anthropic", listed: LISTED }],
        ran: [],
        declared: "claude-opus-4-8",
      }),
    ).toBe("anthropic/claude-opus-4-8");
    expect(
      convertedDefaultModel({
        harness: "claude-code",
        setting: "opus",
        providers: [{ alias: "anthropic", listed: LISTED }],
        ran: [],
        declared: "claude-opus-9",
      }),
    ).toBe("anthropic/claude-opus-5-5");
  });

  // TEST_SCENARIO: a provider with no model of the tier gets no other tier in its place, so the owner picks.
  it("takes no other tier when the provider has none of it", () => {
    expect(
      convertedDefaultModel({
        harness: "claude-code",
        setting: "opus",
        providers: [{ alias: "ibm", listed: ["aws/claude-sonnet-5-5"] }],
        ran: [],
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: Haiku on a provider that lists none runs on its newest Sonnet, as the gateway served it before the Model Router, and is noted; Haiku where it is listed, or any other tier missing, is not substituted.
  it("runs Haiku on the newest Sonnet only where the provider has no Haiku", () => {
    const ibm = (setting: string, listed: string[]) =>
      convertedDefault({
        harness: "claude-code",
        setting,
        providers: [{ alias: "ibm", listed }],
        ran: [],
      });
    expect(
      ibm("haiku", ["aws/claude-sonnet-4-6", "aws/claude-sonnet-5-5"]),
    ).toEqual({ model: "ibm/aws/claude-sonnet-5-5", changedFrom: "haiku" });
    expect(
      ibm("haiku", ["aws/claude-haiku-4-5", "aws/claude-sonnet-5-5"]),
    ).toEqual({
      model: "ibm/aws/claude-haiku-4-5",
    });
    expect(ibm("opus", ["aws/claude-sonnet-5-5"])).toBeNull();
    expect(ibm("haiku", ["aws/gpt-5.5"])).toBeNull();
  });

  // TEST_SCENARIO: a tier word the fitting providers cannot answer falls to the platform's preference list, and a default that lands on another tier keeps that word as `changedFrom` once the Agent's calls ran that tier, so its owner is told which model the runs it pays for replaced; a tier they can answer names the model the setting meant, and a tier nobody ran — an image's preset on a new Agent — was never its owner's choice, so it gets no note.
  it("notes a default of another tier only where the agent ran it", () => {
    const cb = {
      alias: "cb",
      listed: ["rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"],
    };
    const anthropic = { alias: "anthropic", listed: ["claude-opus-5-5"] };
    const deepSeek = "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017";
    expect(
      convertedDefault({
        harness: "claude-code",
        setting: "opus",
        providers: [cb],
        ran: ["claude-opus-5-5"],
      }),
    ).toEqual({ model: deepSeek, changedFrom: "opus" });
    expect(
      convertedDefault({
        harness: "claude-code",
        setting: "opus",
        providers: [cb],
        ran: [],
      }),
    ).toEqual({ model: deepSeek });
    expect(
      convertedDefault({
        harness: "claude-code",
        setting: "opus",
        providers: [cb],
        ran: ["claude-sonnet-5-5"],
      }),
    ).toEqual({ model: deepSeek });
    expect(
      convertedDefault({
        harness: "claude-code",
        setting: "opus",
        providers: [anthropic],
        ran: ["claude-opus-5-5"],
      }),
    ).toEqual({ model: "anthropic/claude-opus-5-5" });
    expect(
      convertedDefault({
        harness: "claude-code",
        setting: "opus",
        providers: [anthropic, cb],
        ran: ["claude-opus-5-5"],
      }),
    ).toEqual({ model: "anthropic/claude-opus-5-5" });
  });

  // TEST_SCENARIO: a model id is kept in the provider's own spelling when the provider lists it, and dropped when it does not.
  it("keeps a listed model id and drops an unlisted one", () => {
    expect(convert("Claude-Opus-4-8")).toBe("anthropic/claude-opus-4-8");
    expect(convert("anthropic/claude-opus-4-8")).toBe(
      "anthropic/claude-opus-4-8",
    );
    expect(convert("claude-opus-3")).toBeNull();
  });

  // TEST_SCENARIO: the harness's own default is the model the Agent's calls mostly ran when the provider lists it; a model they ran less never stands in for an unlisted one, so that case falls to the platform's preferred model.
  it("takes the model the agent mostly ran for the harness default", () => {
    expect(convert("default", ["claude-opus-4-8", "claude-opus-3"])).toBe(
      "anthropic/claude-opus-4-8",
    );
    expect(convert("default", ["claude-opus-3", "claude-opus-4-8"])).toBe(
      "anthropic/claude-opus-5-5",
    );
    expect(convert(null, ["claude/claude-sonnet-5-5"])).toBe(
      "anthropic/claude-sonnet-5-5",
    );
    expect(convert("default", [])).toBe("anthropic/claude-opus-5-5");
  });
});

describe("convertedDefaultModel on Bob's own gateway", () => {
  const BOB = ["background", "explorer", "fast", "gpt-oss-20b", "premium-ide"];

  // TEST_SCENARIO: 20 of 22 Bob agents converted to "not set" on 0.2.24: they named no model and ran on Bob's built-in default, which the preference list does not know, so they convert to the Bob model owners run on (`fast`, else `explorer`) — before any other provider's model, since a Bob agent runs on Bob, and no other provider's `fast` is taken for Bob's.
  it("takes Bob's built-in default for an agent that named no model", () => {
    const bob = { alias: "bob", listed: BOB };
    expect(
      convertedDefaultModel({
        harness: "bob",
        setting: null,
        providers: [bob],
        ran: [],
      }),
    ).toBe("bob/fast");
    expect(
      convertedDefaultModel({
        harness: "bob",
        setting: null,
        providers: [{ alias: "ibm", listed: ["aws/claude-opus-5-5"] }, bob],
        ran: [],
      }),
    ).toBe("bob/fast");
    expect(
      convertedDefaultModel({
        harness: "claude-code",
        setting: null,
        providers: [{ alias: "ibm", listed: ["aws/claude-opus-5-5"] }, bob],
        ran: [],
      }),
    ).toBe("ibm/aws/claude-opus-5-5");
    expect(
      convertedDefaultModel({
        harness: "bob",
        setting: null,
        providers: [{ alias: "bob", listed: ["background", "explorer"] }],
        ran: [],
      }),
    ).toBe("bob/explorer");
    expect(
      convertedDefaultModel({
        harness: "bob",
        setting: null,
        providers: [{ alias: "ibm", listed: ["xai/grok-4-fast"] }, bob],
        ran: [],
      }),
    ).toBe("bob/fast");
    expect(
      convertedDefaultModel({
        harness: "bob",
        setting: null,
        providers: [{ alias: "ibm", listed: ["xai/grok-4-fast"] }],
        ran: [],
      }),
    ).toBeNull();
    expect(
      convertedDefaultModel({
        harness: "bob",
        setting: "codestral-2508",
        providers: [bob],
        ran: [],
      }),
    ).toBeNull();
  });
});

describe("convertedDefaultModel on several fitting providers", () => {
  const both = (setting: string | null, ran: string[] = []) =>
    convertedDefaultModel({
      harness: "claude-code",
      setting,
      ran,
      providers: [
        { alias: "anthropic", listed: ["claude-opus-4-8", "claude-opus-5-5"] },
        {
          alias: "cb",
          listed: ["rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"],
        },
      ],
    });

  // TEST_SCENARIO: an id the setting or the history names is the person's own pick, and it names the same model whichever provider is asked, so it wins over the platform's preferred model; a setting naming no model — the harness's own `default`, or no history — goes to the list, where a Claude Code agent's own models come first and DeepSeek follows.
  it("keeps the person's own model, and reads the list where the setting names none", () => {
    expect(both("claude-opus-4-8")).toBe("anthropic/claude-opus-4-8");
    expect(both("default", ["claude-opus-4-8"])).toBe(
      "anthropic/claude-opus-4-8",
    );
    expect(both(null, ["claude-opus-5-5"])).toBe("anthropic/claude-opus-5-5");
    expect(both("default", [])).toBe("anthropic/claude-opus-5-5");
    expect(
      convertedDefaultModel({
        harness: "claude-code",
        setting: "opus",
        providers: [
          {
            alias: "cb",
            listed: ["rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"],
          },
        ],
        ran: [],
      }),
    ).toBe("cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017");
  });

  // TEST_SCENARIO: a tier word names a model on every provider that lists it, so several fitting providers no longer send it to the list: the harness's own provider order picks the provider, and that provider's newest model of the tier answers — never the tier the list prefers, and never the provider that happens to be listed first.
  it("answers a tier word from its providers in the harness's order", () => {
    const tiers = (
      setting: string,
      providers: { alias: string; listed: string[] }[],
    ) =>
      convertedDefaultModel({
        harness: "claude-code",
        setting,
        providers,
        ran: [],
      });
    expect(
      tiers("sonnet", [
        {
          alias: "ibm",
          listed: ["aws/claude-sonnet-4-6", "aws/claude-sonnet-5-5"],
        },
        { alias: "anthropic", listed: ["claude-opus-5-5"] },
      ]),
    ).toBe("ibm/aws/claude-sonnet-5-5");
    expect(
      tiers("sonnet", [
        { alias: "ibm", listed: ["aws/claude-opus-5-5"] },
        {
          alias: "anthropic",
          listed: ["claude-sonnet-5-5", "claude-opus-5-5"],
        },
      ]),
    ).toBe("anthropic/claude-sonnet-5-5");
    expect(
      tiers("sonnet", [
        { alias: "anthropic", listed: ["claude-opus-5-5"] },
        {
          alias: "cb",
          listed: ["rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"],
        },
      ]),
    ).toBe("anthropic/claude-opus-5-5");
  });

  // TEST_SCENARIO: a kit's declared model is what the agent was created for, so it answers before the several-providers shortcut and before the Haiku substitution, and it is found on whichever fitting provider lists it.
  it("takes the kit's declared model before anything else", () => {
    expect(
      convertedDefault({
        harness: "claude-code",
        setting: "haiku",
        ran: [],
        declared: "claude-opus-5-5",
        providers: [
          { alias: "anthropic", listed: ["claude-opus-5-5"] },
          {
            alias: "cb",
            listed: ["rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"],
          },
        ],
      }),
    ).toEqual({ model: "anthropic/claude-opus-5-5" });
    expect(
      convertedDefault({
        harness: "claude-code",
        setting: "haiku",
        ran: [],
        declared: "claude-opus-5-5",
        providers: [{ alias: "ibm", listed: ["aws/claude-opus-5-5"] }],
      }),
    ).toEqual({ model: "ibm/aws/claude-opus-5-5" });
  });

  // TEST_SCENARIO: an id no provider lists is still the owner's call, not a reason to run the platform's preferred model in its place.
  it("drops an id no provider lists rather than substituting one", () => {
    expect(both("claude-opus-3")).toBeNull();
  });

  // TEST_SCENARIO: the providers are asked in alias order, so two of them listing the same recorded model resolve the way a default provider always has.
  it("asks the providers in alias order", () => {
    expect(
      convertedDefaultModel({
        harness: "claude-code",
        setting: "default",
        ran: ["claude-sonnet-5-5"],
        providers: [
          { alias: "anthropic", listed: ["claude-sonnet-5-5"] },
          { alias: "ibm", listed: ["aws/claude-sonnet-5-5"] },
        ],
      }),
    ).toBe("anthropic/claude-sonnet-5-5");
  });
});

describe("convertedDefaultModel on a provider that prefixes its ids", () => {
  // TEST_SCENARIO: Claude Code on IBM records a call's model without IBM's route prefix, so the harness default matches the one listed id ending in that name, and none when two routes list it.
  it("matches the recorded name to the one listed id ending in it", () => {
    const convert = (listed: string[]) =>
      convertedDefaultModel({
        harness: "claude-code",
        setting: null,
        providers: [{ alias: "ibm", listed }],
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
    kitDefaultModel?: string | null;
  }) => {
    const writes: SessionPair[] = [];
    const notes: unknown[] = [];
    let saved = opts.saved ?? null;
    const ranQueries: number[] = [];
    const wakes: string[] = [];
    let catalogReads = 0;
    let moved = opts.moved ?? false;
    let awake = opts.running ?? true;
    let clock = 0;
    const c = createDefaultConverter({
      pairRepo: {
        read: async () => saved,
        readSaved: async () => ({
          chat: saved,
          channel: null,
          scheduled: null,
          chatProfileId: null,
        }),
        write: async () => {},
        clear: async () => {},
        writeIfEmpty: async (_id, pair, note) => {
          if (saved?.model) return false;
          saved = pair;
          writes.push(pair);
          if (note) notes.push(note);
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
        locked: (async (_agentId: string, work: (tx: never) => unknown) =>
          work({} as never)) as never,
      },
      catalog: CATALOG,
      getCapabilities: async () => opts.capabilities ?? ROUTED,
      specHarness: async () => undefined,
      catalogView: async () => {
        catalogReads++;
        if (!awake) throw new Error("runtime asleep");
        return opts.catalog === undefined
          ? view("listed", ["claude-opus-4-8", "claude-opus-5-5"])
          : opts.catalog;
      },
      modelsRanBy: async (_id, hours) => {
        ranQueries.push(hours);
        return hours >= 7 * 24 ? (opts.ran ?? []) : [];
      },
      kitDefaultModel: async () => opts.kitDefaultModel ?? null,
      movedToNewImage: async () => moved,
      isRunning: async () => opts.running ?? true,
      wake: async (id) => {
        wakes.push(id);
        awake = true;
        if (opts.helloAfterWake !== false) moved = false;
        return { previous: "T0", written: "T1" };
      },
      lastHelloAt: async () =>
        opts.helloAfterWake === false ? 0 : Number.MAX_SAFE_INTEGER,
      onSaved: () => {},
      now: () => (clock += 60_000),
      log: () => {},
      sleep: async () => {},
    });
    return {
      c,
      writes,
      notes,
      ranQueries,
      wakes,
      catalogReads: () => catalogReads,
    };
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

  // TEST_SCENARIO: a kit that needs its Agent on one model has it as the saved default when the granted provider lists it, and the tier conversion stands when the provider lists another model instead.
  it("saves the model the kit declared, on the granted provider", async () => {
    const declared = converter({
      kitDefaultModel: "claude-opus-4-8",
      catalog: view("listed", ["claude-opus-4-8", "claude-opus-5-5"]),
    });
    expect(await declared.c.convert("a")).toBe("converted");
    expect(declared.writes[0]?.model).toBe("anthropic/claude-opus-4-8");

    const unlisted = converter({
      kitDefaultModel: "claude-opus-9",
      catalog: view("listed", ["claude-opus-5-5"]),
    });
    expect(await unlisted.c.convert("a")).toBe("converted");
    expect(unlisted.writes[0]?.model).toBe("anthropic/claude-opus-5-5");
  });

  // TEST_SCENARIO: a Haiku setting on a provider with no Haiku saves the newest Sonnet together with a note, so the owner is told.
  it("saves the Sonnet that replaces Haiku with a note", async () => {
    const { c, writes, notes } = converter({
      setting: "haiku",
      catalog: view("listed", ["claude-sonnet-5-5", "claude-opus-5-5"]),
    });
    expect(await c.convert("a")).toBe("converted");
    expect(writes[0]?.model).toBe("anthropic/claude-sonnet-5-5");
    expect(notes).toEqual([{ changedFrom: "haiku" }]);
  });

  // TEST_SCENARIO: several providers fit, so no provider's own order can say which one the person meant; the platform's preferred model list decides, and the provider that supplies it is saved with it.
  it("lets the preferred model list decide across several providers", async () => {
    const ibm = view("listed", ["aws/claude-sonnet-5-5"]);
    const two: HarnessCatalogView = {
      ...ibm,
      providers: [
        { ...ibm.providers[0]!, connectionId: "lite", alias: "ibm" },
        {
          ...ibm.providers[0]!,
          connectionId: "anth",
          alias: "anthropic",
          models: [
            {
              name: "claude/anthropic/claude-opus-5-5",
              upstreamId: "claude-opus-5-5",
            },
          ] as never,
        },
      ],
    };
    const { c, writes } = converter({
      granted: [IBM, ANTHROPIC],
      catalog: two,
    });
    expect(await c.convert("a")).toBe("converted");
    expect(writes).toEqual([
      {
        harness: "claude-code",
        provider: "anth",
        model: "anthropic/claude-opus-5-5",
      },
    ]);
  });

  // TEST_SCENARIO: with one provider and nothing that resolves, the save keeps that provider so the picker remembers which one the agent holds, and only the model is left for the owner.
  it("keeps the one provider when no model resolves", async () => {
    const options = {
      setting: "claude-opus-3",
      catalog: view("listed", ["claude-opus-4-8"]),
    };
    const { c, writes } = converter(options);
    expect(await c.convert("a")).toBe("not-set");
    expect(writes).toEqual([
      { harness: "claude-code", provider: "anth", model: null },
    ]);
  });

  // TEST_SCENARIO: the provider has not listed its models yet, so nothing is decided or saved; a later try converts.
  it("waits while the provider has not listed", async () => {
    const { c, writes } = converter({ catalog: view("unavailable", []) });
    expect(await c.convert("a")).toBe("waiting");
    expect(writes).toEqual([]);
  });

  // TEST_SCENARIO: one fitting provider has not listed while another has, so nothing is saved yet: converting without the late one would make the listed provider's model permanent and the platform's preferred model could never win.
  it("waits while any fitting provider has not listed", async () => {
    const listed = view("listed", ["claude-opus-5-5"]);
    const partially: HarnessCatalogView = {
      ...listed,
      providers: [
        { ...listed.providers[0]!, connectionId: "lite", alias: "ibm" },
        {
          ...listed.providers[0]!,
          connectionId: "anth",
          alias: "anthropic",
          status: "unavailable",
          models: [],
        },
      ],
    };
    const { c, writes } = converter({
      granted: [IBM, ANTHROPIC],
      catalog: partially,
    });
    expect(await c.convert("a")).toBe("waiting");
    expect(writes).toEqual([]);
  });

  // TEST_SCENARIO: a fitting provider the listing does not mention at all counts as late too, so a fresh listing that has dropped it does not convert the rest.
  it("waits while a fitting provider is missing from the listing", async () => {
    const { c, writes } = converter({ granted: [IBM, ANTHROPIC] });
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
  it("reads telemetry for the harness default and for a tier, narrowest window first", async () => {
    const tier = converter({ ran: [] });
    await tier.c.convert("a");
    expect(tier.ranQueries).toEqual([24, 7 * 24, 30 * 24]);

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

  // TEST_SCENARIO: 0.2.24 saved "not set" for Bob agents whose provider listed no model the conversion knew; once the runtime lists one, the next hello converts the default instead of leaving every schedule failing for good.
  it("converts again over a saved not set", async () => {
    const notSet = { harness: "claude-code", provider: "anth", model: null };
    const { c, writes } = converter({ saved: notSet });
    expect(await c.convert("a")).toBe("converted");
    expect(writes).toEqual([
      {
        harness: "claude-code",
        provider: "anth",
        model: "anthropic/claude-opus-5-5",
      },
    ]);

    const still = converter({
      saved: notSet,
      setting: "claude-opus-3",
      catalog: view("listed", ["claude-opus-4-8"]),
    });
    expect(await still.c.convert("a")).toBe("not-set");
    expect(still.writes).toEqual([]);
  });

  // TEST_SCENARIO: an asleep Agent whose default is "not set" runs its fire and "Run now" on the automatic model, so neither wakes it nor waits on a conversion; the next hello converts it.
  it("neither wakes nor holds a not-set agent for a fire or Run now", async () => {
    const notSet = { harness: "claude-code", provider: "anth", model: null };
    const asleep = converter({ running: false, saved: notSet });
    expect(await asleep.c.ensureForFire("a")).toBeNull();
    expect(await asleep.c.pendingAfterMove("a")).toBe(false);
    expect(asleep.wakes).toEqual([]);
    expect(asleep.writes).toEqual([]);
  });

  // TEST_SCENARIO: converting a "not set" again keeps the harness and the provider it names, so the agent's runs never move to another harness or provider: a Codex pair stays unconverted on a Claude Code runtime, and a pair naming IBM is not filled from Anthropic.
  it("keeps the harness and provider of a not set", async () => {
    const codex = converter({
      saved: { harness: "codex", provider: null, model: null },
    });
    expect(await codex.c.convert("a")).toBe("not-set");
    expect(codex.writes).toEqual([]);

    const ibm = converter({
      saved: { harness: "claude-code", provider: "lite", model: null },
    });
    expect(await ibm.c.convert("a")).toBe("not-set");
    expect(ibm.writes).toEqual([]);
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
        locked: (async (_agentId: string, work: (tx: never) => unknown) =>
          work({} as never)) as never,
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

describe("defaultModelNoticesOf", () => {
  const pair = (model: string | null, provider: string | null = "anth") => ({
    harness: "claude-code",
    provider,
    model,
  });
  const notice = (
    p: SessionPair | null,
    opts: {
      note?: { changedFrom: string };
      aliases?: string[];
      routed?: boolean;
      runsUnattended?: boolean;
    } = {},
  ) =>
    defaultModelNoticesOf({
      agentId: "a",
      routed: opts.routed ?? true,
      saved: { chat: p, channel: null, scheduled: null },
      note: opts.note ?? null,
      grantedAliases: new Set(opts.aliases ?? ["anthropic"]),
      runsUnattended: opts.runsUnattended ?? true,
    })[0]?.state ?? null;

  // TEST_SCENARIO: the owner is told about a default with no provider to pick from, one whose model names a provider alias the Agent no longer holds, and a converted one that runs another model than its setting named; a pending default, one with no model, which runs on the automatic model, and one that runs as saved say nothing.
  it("names the state the owner must know about", () => {
    expect(notice(null)).toBeNull();
    expect(notice(pair(null, null))).toBeNull();
    expect(notice(pair(null, null), { aliases: [] })).toBe("no-provider");
    expect(notice(pair("ibm/aws/claude-opus-4-8", "lite"))).toBe(
      "provider-gone",
    );
    expect(
      notice(pair("anthropic/claude-sonnet-5-5"), {
        note: { changedFrom: "haiku" },
      }),
    ).toBe("changed");
    expect(notice(pair("anthropic/claude-opus-5-5"))).toBeNull();
  });

  // TEST_SCENARIO: runs take the provider from the model's alias, so a replaced Connection of the same alias keeps the default running, and a pair naming no Connection is gone when no provider of its alias is held.
  it("judges the provider by the model's alias, not the saved Connection id", () => {
    expect(notice(pair("anthropic/claude-opus-5-5", "old-conn"))).toBeNull();
    expect(notice(pair("ibm/aws/claude-opus-4-8", null))).toBe("provider-gone");
  });

  // TEST_SCENARIO: a scheduled default of its own runs schedules even while the chat default's provider is gone, so only chat and channel, which run on the chat default, are named as stopped.
  it("names only the kinds whose default cannot run", () => {
    const notices = defaultModelNoticesOf({
      agentId: "a",
      routed: true,
      saved: {
        chat: pair("ibm/aws/claude-opus-4-8", "lite"),
        channel: null,
        scheduled: pair("anthropic/claude-opus-5-5"),
      },
      note: null,
      grantedAliases: new Set(["anthropic"]),
      runsUnattended: true,
    });
    expect(notices).toEqual([
      expect.objectContaining({
        id: "a:chat+channel:provider-gone",
        kinds: ["chat", "channel"],
        state: "provider-gone",
      }),
    ]);
  });

  // TEST_SCENARIO: an Agent on an older runtime runs a default with no model on its harness's own model, so it gets no notice.
  it("says nothing for an Agent off the Model Router", () => {
    expect(notice(pair(null, null), { routed: false })).toBeNull();
    expect(
      notice(pair("ibm/aws/claude-opus-4-8", "lite"), { routed: false }),
    ).toBeNull();
  });

  // TEST_SCENARIO: a default that stops runs fails nothing on an Agent with no enabled Schedule and no Slack or Telegram Channel bound, so its owner is not told; a run of any of those kinds makes every such state count.
  it("says nothing where no unattended run exists", () => {
    const idle = { runsUnattended: false };
    expect(notice(pair(null, null), idle)).toBeNull();
    expect(notice(pair(null, null), { ...idle, aliases: [] })).toBeNull();
    expect(notice(pair("ibm/aws/claude-opus-4-8", "lite"), idle)).toBeNull();
    expect(
      notice(pair(null, null), { runsUnattended: true, aliases: [] }),
    ).toBe("no-provider");
  });

  // TEST_SCENARIO: a converted default names the model every run pays for, so its owner is told even on an Agent that runs nothing unattended.
  it("tells a conversion whatever the Agent runs", () => {
    expect(
      notice(pair("anthropic/claude-sonnet-5-5"), {
        note: { changedFrom: "haiku" },
        runsUnattended: false,
      }),
    ).toBe("changed");
  });
});

describe("defaultModelNoticesOf — a chat default held by a profile", () => {
  const input = {
    agentId: "agent-1",
    routed: true,
    saved: {
      chat: {
        harness: "claude-code",
        provider: "conn-1",
        model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
      },
      channel: null,
      scheduled: null,
    },
    note: null,
    grantedAliases: new Set(["cb"]),
    runsUnattended: true,
  };

  /** TEST_SCENARIO: a chat profile whose provider the Agent cannot run reads as a gone provider, not as a working default. */
  it("says the provider is gone when the profile cannot run here", () => {
    expect(
      defaultModelNoticesOf({ ...input, profileUnavailable: true }).map(
        (n) => n.state,
      ),
    ).toEqual(["provider-gone"]);
    expect(defaultModelNoticesOf(input)).toEqual([]);
  });
});
