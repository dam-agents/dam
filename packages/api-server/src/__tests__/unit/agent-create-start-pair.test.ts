// TEST_OVERVIEW: The chat default a create names is checked against the owner's provider catalog before the agent exists — the model's provider granted, running the harness, listing the model, and the harness keeping each setting — and a create that names only its provider starts on that provider's preferred model.
import { describe, expect, it, vi } from "vitest";
import type {
  OwnerModelCatalogView,
  ProviderCatalogView,
} from "api-server-api";
import { createStartPair } from "../../modules/harness-config/services/start-pair.js";

const provider = (
  over: Partial<ProviderCatalogView> & { connectionId: string },
): ProviderCatalogView => ({
  alias: "anthropic",
  template: "anthropic-oauth",
  displayName: "Anthropic",
  status: "listed",
  listedAt: null,
  harnesses: ["claude-code"],
  models: ["claude-opus-5-5", "claude-mythos-5-2"].map((upstreamId) => ({
    name: `anthropic/${upstreamId}`,
    upstreamId,
    contextWindow: null,
    maxOutputTokens: null,
    reasoning: null,
    vision: null,
    prices: null,
    source: { limits: "none", prices: "none" },
    harnesses: ["claude-code"],
  })),
  ...over,
});

const ANTHROPIC = provider({ connectionId: "conn-anthropic" });
const CB = provider({
  connectionId: "conn-cb",
  alias: "cb",
  template: "curve-bender",
  displayName: "CurveBender",
  harnesses: ["claude-code", "pi"],
  models: [],
});

function setup(providers: ProviderCatalogView[] = [ANTHROPIC, CB]) {
  const view: OwnerModelCatalogView = {
    defaultHarness: "claude-code",
    modelRouter: true,
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
              category: "thought_level",
              choices: [
                { value: "low", name: "Low" },
                { value: "high", name: "High" },
              ],
            },
          ],
        },
      },
    ],
    providers,
  } as unknown as OwnerModelCatalogView;
  const write = vi.fn(async () => true);
  return {
    startPair: createStartPair({ ownerCatalog: async () => view, write }),
    write,
  };
}

describe("the chat default a create names", () => {
  /** TEST_SCENARIO: The issue's ask: an Anthropic subscription on Claude Code with its model, kept as the provider spells it, on the Connection the create grants. */
  it("takes a model the granted provider lists for the harness", async () => {
    const { startPair } = setup();
    await expect(
      startPair.check(
        {
          harness: "claude-code",
          model: "anthropic/Claude-Mythos-5-2",
          settings: { effort: "high" },
        },
        ["conn-anthropic"],
      ),
    ).resolves.toEqual({
      harness: "claude-code",
      provider: "conn-anthropic",
      model: "anthropic/claude-mythos-5-2",
      settings: { effort: "high" },
    });
  });

  it.each([
    ["a bare model name", "claude-code", "claude-opus-5-5", ["conn-anthropic"], "name the model with its provider"],
    ["a provider the create does not grant", "claude-code", "anthropic/claude-opus-5-5", ["conn-cb"], "holds no anthropic provider"],
    ["a harness the provider cannot run", "pi", "anthropic/claude-opus-5-5", ["conn-anthropic"], "the pi harness cannot run on Anthropic"],
    ["a model the provider does not list", "claude-code", "anthropic/claude-nope", ["conn-anthropic"], "lists no claude-nope"],
  ])("refuses %s", async (_label, harness, model, granted, reason) => {
    const { startPair } = setup();
    await expect(
      startPair.check({ harness, model }, granted),
    ).rejects.toThrow(reason);
  });

  /** TEST_SCENARIO: A provider that has not listed yet cannot say no, so its model is taken as named; the first run checks it against the listing. */
  it("takes a model of a provider that has not listed", async () => {
    const { startPair } = setup([
      { ...ANTHROPIC, status: "unavailable", models: [] },
    ]);
    await expect(
      startPair.check(
        { harness: "claude-code", model: "anthropic/claude-new" },
        ["conn-anthropic"],
      ),
    ).resolves.toMatchObject({ model: "anthropic/claude-new" });
  });

  it("refuses a setting the harness does not keep", async () => {
    const { startPair } = setup();
    await expect(
      startPair.check(
        {
          harness: "claude-code",
          model: "anthropic/claude-opus-5-5",
          settings: { effort: "extreme" },
        },
        ["conn-anthropic"],
      ),
    ).rejects.toThrow("effort");
  });

  /** TEST_SCENARIO: A create that names only its provider starts on the model the platform prefers among those it lists for the harness, and on none while it has listed nothing. */
  it("picks a listed model of the named provider", async () => {
    const { startPair } = setup();
    expect(
      await startPair.pick("claude-code", "conn-anthropic"),
    ).toMatch(/^anthropic\/claude-/);
    expect(await startPair.pick("claude-code", "conn-cb")).toBeNull();
    expect(await startPair.pick("pi", "conn-anthropic")).toBeNull();
  });

  it("refuses a save onto an agent that already holds a default", async () => {
    const { startPair, write } = setup();
    write.mockResolvedValueOnce(false);
    await expect(
      startPair.save("agent-1", {
        harness: "claude-code",
        provider: "conn-anthropic",
        model: "anthropic/claude-opus-5-5",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
