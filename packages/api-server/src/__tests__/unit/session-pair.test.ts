import { describe, expect, it } from "vitest";
import {
  resolveSessionPair,
  type SessionPairInputs,
} from "../../modules/harness-config/domain/session-pair.js";
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

describe("resolveFirePair", () => {
  /** TEST_SCENARIO: A schedule saved with only a model was set up against the
   * provider the person last picked for this harness, so it fires there, not
   * on whichever provider was granted first. */
  it("keeps the remembered provider for a schedule that names only a model", async () => {
    const pair = await resolveFirePair(
      {
        pairRepo: {
          read: async () => ({
            harness: "claude-code",
            provider: "second",
            model: "old",
          }),
          write: async () => {},
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
        getCapabilities: async () => ({
          defaultHarness: "claude-code",
          harnesses: [
            { name: "claude-code", harnessConfig: true, sessionModel: true },
          ],
        }),
      },
      "agent-1",
      { model: "opus" },
    );
    expect(pair).toEqual({
      harness: "claude-code",
      provider: "second",
      model: "opus",
    });
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
        pairRepo: {
          read: async () => null,
          write: async () => {},
          grantedProviders: async () => [{ id: "lite", type: "ibm-litellm" }],
        },
        catalog: {
          default: "claude-code",
          harnesses: [],
          telemetryEnv: () => [],
        },
        getCapabilities: async () => ({
          defaultHarness: "mock",
          harnesses: [
            { name: "mock", harnessConfig: false, sessionModel: false },
          ],
        }),
      },
      "agent-1",
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
          pairRepo: {
            read: async () => null,
            write: async () => {},
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
          getCapabilities: async () => ({
            defaultHarness: "mock",
            harnesses: [
              { name: "mock", harnessConfig: false, sessionModel: false },
              { name: "claude-code", harnessConfig: true, sessionModel: true },
            ],
          }),
        },
        "agent-1",
      ),
    ).toBeNull();
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
