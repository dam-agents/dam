/**
 * TEST_OVERVIEW: Where a Claude Code side call on a tier runs when its session
 * is on another provider: the tier word or slot the call names on the
 * session's provider, else the session's own model. CurveBender's ids carry no
 * tier word, so its slots are filled from the platform's preferred work model.
 * The classifier's own model comes from its knob, not a slot
 * (harness-env.test.ts).
 */
import { describe, expect, it } from "vitest";
import type { ProviderAlias } from "api-server-api";
import type {
  CatalogEntry,
  CatalogProvider,
} from "../../modules/model-catalog/index.js";
import { tierModelOnSessionProvider } from "../../modules/model-router/index.js";
import type { ModelRouterBinding } from "../../modules/runtime-channel/manifest.js";

const binding: ModelRouterBinding = {
  dialects: ["anthropic-messages"],
  namePrefix: "claude/",
  lowercaseNames: true,
  claudeTiers: true,
};

const CB_WORK = "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017";

const entry = (alias: ProviderAlias, upstreamId: string) =>
  ({
    name: `${alias}/${upstreamId}`,
    alias,
    connectionId: `conn-${alias}`,
    template: alias,
    upstreamId,
    dialects: ["anthropic-messages"],
    metadata: {
      contextWindow: 1_048_576,
      maxOutputTokens: null,
      reasoning: null,
      vision: null,
      cacheControl: null,
      thinkingFormat: null,
      prices: null,
      source: { limits: "none", prices: "none" },
    },
  }) as CatalogEntry;

const provider = (alias: ProviderAlias, ids: string[]): CatalogProvider => ({
  connectionId: `conn-${alias}`,
  alias,
  template: alias === "cb" ? "curve-bender" : alias,
  displayName: alias,
  dialects: ["anthropic-messages"],
  status: "listed",
  listedAt: null,
  entries: ids.map((id) => entry(alias, id)),
});

const where = (input: {
  requested: string;
  sessionModel: string;
  providers: readonly CatalogProvider[];
}) =>
  tierModelOnSessionProvider({
    ...input,
    harness: "claude-code",
    binding,
  });

const cbTierless = provider("cb", ["rits/zai-org/glm-5-4", CB_WORK]);

describe("a side call on a tier", () => {
  /** TEST_SCENARIO: CurveBender lists no tier word, so every slot call of a session there runs on the work model it already holds, and a bare Sonnet name reads as the tier word it is — no other model of the preference list takes its place, since the classifier comes from Claude Code's own knob. */
  it("keeps a slot call, and a bare Sonnet name, on the session's model", () => {
    const session = `cb/${CB_WORK}`;
    expect(
      where({
        requested: "haiku[1m]",
        sessionModel: session,
        providers: [cbTierless],
      }),
    ).toBe(`claude/cb/${CB_WORK.toLowerCase()}`);
    expect(
      where({
        requested: "claude-sonnet-5",
        sessionModel: session,
        providers: [cbTierless],
      }),
    ).toBe(`claude/cb/${CB_WORK.toLowerCase()}`);
  });

  /** TEST_SCENARIO: A tierless provider that lists nothing on the preference
   * lists keeps the session's own model, as the built-in provider does, and
   * an Anthropic model's tier slot still follows the session's provider by
   * tier word. */
  it("keeps the session's model where the preference lists match nothing", () => {
    const platform = provider("platform", ["deepseek-v4.1-flash", "qwen-9"]);
    expect(
      where({
        requested: "claude-sonnet-5",
        sessionModel: "platform/deepseek-v4.1-flash",
        providers: [platform],
      }),
    ).toBe("claude/platform/deepseek-v4.1-flash");
    expect(
      where({
        requested: "claude/anthropic/claude-haiku-5-5",
        sessionModel: "platform/deepseek-v4.1-flash",
        providers: [platform],
      }),
    ).toBe("claude/platform/deepseek-v4.1-flash");
    const ibm = provider("ibm", [
      "aws/claude-opus-5-5",
      "aws/claude-sonnet-5-5",
    ]);
    expect(
      where({
        requested: "claude-sonnet-5",
        sessionModel: "ibm/aws/claude-opus-5-5",
        providers: [ibm],
      }),
    ).toBe("claude/ibm/aws/claude-sonnet-5-5");
  });
});
