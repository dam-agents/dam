/**
 * TEST_OVERVIEW: Where a Claude Code side call on a tier runs when its session
 * is on another provider: the tier word or slot the call names on the
 * session's provider, else the session's own model. CurveBender's ids carry no
 * tier word, so its slots are filled from the platform's preferred model list
 * and its auto-mode classifier — a bare Sonnet — is the one call that list
 * answers with another model, the classifier's own preferred one.
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
const CB_CLASSIFIER = "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4";

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

const cbTierless = provider("cb", [
  "rits/zai-org/glm-5-4",
  CB_CLASSIFIER,
  CB_WORK,
]);

describe("a side call on a tier", () => {
  /** TEST_SCENARIO: CurveBender lists no tier word, so the classifier's bare
   * Sonnet is the one call that names another model: it lands on the
   * platform's preferred classifier, while a Haiku or Opus slot call, and
   * Claude Code's Sonnet slot when it arrives by a qualified name, run on the
   * work model the session already holds. */
  it("answers the classifier on its own model, and every other slot on the work model", () => {
    const session = `cb/${CB_WORK}`;
    expect(
      where({
        requested: "claude-sonnet-5",
        sessionModel: session,
        providers: [cbTierless],
      }),
    ).toBe(`claude/cb/${CB_CLASSIFIER.toLowerCase()}`);
    expect(
      where({
        requested: "haiku[1m]",
        sessionModel: session,
        providers: [cbTierless],
      }),
    ).toBe(`claude/cb/${CB_WORK.toLowerCase()}`);
    expect(
      where({
        requested: `claude/cb/${CB_WORK.toLowerCase()}`,
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

  /** TEST_SCENARIO: The classifier's model is matched against the listing it
   * would run on, so a CurveBender that lists another Nemotron version and not
   * the one the list names keeps the session's model rather than running on a
   * version nobody chose. */
  it("refuses another version of the classifier's model", () => {
    const older = provider("cb", [
      CB_WORK,
      "rits/nvidia/NVIDIA-Nemotron-4-Ultra",
    ]);
    expect(
      where({
        requested: "claude-sonnet-5",
        sessionModel: `cb/${CB_WORK}`,
        providers: [older],
      }),
    ).toBe(`claude/cb/${CB_WORK.toLowerCase()}`);
  });
});
