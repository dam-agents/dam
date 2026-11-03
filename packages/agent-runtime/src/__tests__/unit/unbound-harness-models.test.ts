import { describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
  ModelMetadata,
} from "../../modules/model-catalog/index.js";
import { unboundHarnessModels } from "../../modules/model-router/domain/unbound-harness-models.js";

/**
 * TEST_OVERVIEW: the model list a harness with no modelRouter section gets
 * from the router: every model the agent's providers list, under its plain
 * qualified name, with the platform's preferred work model first, so a
 * harness that takes the first entry runs on the platform's pick.
 */
const metadata = (over?: Partial<ModelMetadata>): ModelMetadata => ({
  contextWindow: 200_000,
  maxOutputTokens: null,
  reasoning: null,
  vision: null,
  prices: null,
  cacheControl: null,
  thinkingFormat: null,
  source: { limits: "table", prices: "table" },
  ...over,
});

const provider = (
  alias: "ibm" | "cb",
  ids: readonly (string | [string, Partial<ModelMetadata>])[],
): CatalogProvider => ({
  alias,
  connectionId: `conn-${alias}`,
  template: alias === "ibm" ? "ibm-litellm" : "curve-bender",
  displayName: alias.toUpperCase(),
  dialects: ["anthropic-messages", "openai-chat", "openai-responses"],
  status: "listed",
  listedAt: null,
  entries: ids.map((id): CatalogEntry => {
    const [upstreamId, meta] = typeof id === "string" ? [id, undefined] : id;
    return {
      name: `claude/${alias}/${upstreamId}`.toLowerCase(),
      alias,
      connectionId: `conn-${alias}`,
      template: alias === "ibm" ? "ibm-litellm" : "curve-bender",
      upstreamId,
      dialects: ["anthropic-messages", "openai-chat", "openai-responses"],
      metadata: metadata(meta),
    };
  }),
});

describe("unboundHarnessModels", () => {
  /** TEST_SCENARIO: The provider lists the preferred work model behind
   * others; it leads the list, and every name is the plain qualified one,
   * whatever spelling an entry carried. */
  it("puts the preferred work model first, under plain qualified names", () => {
    const models = unboundHarnessModels([
      provider("ibm", [
        "rits/zai-org/glm-5-1",
        "aws/claude-opus-5-5",
        "azure/gpt-5.5",
      ]),
    ]);
    expect(models.map((m) => m.name)).toEqual([
      "ibm/aws/claude-opus-5-5",
      "ibm/rits/zai-org/glm-5-1",
      "ibm/azure/gpt-5.5",
    ]);
  });

  /** TEST_SCENARIO: With no preferred model listed, the providers' order
   * stands; a model known to hold too little context is left out, as for a
   * routed harness. */
  it("keeps the listing order and leaves out a model with too small a window", () => {
    const models = unboundHarnessModels([
      provider("ibm", ["azure/gpt-5.5", ["tiny", { contextWindow: 8_000 }]]),
      provider("cb", ["rits/zai-org/glm-5-3"]),
    ]);
    expect(models.map((m) => m.name)).toEqual([
      "ibm/azure/gpt-5.5",
      "cb/rits/zai-org/glm-5-3",
    ]);
  });

  /** TEST_SCENARIO: A model kept to named harnesses — an Anthropic
   * subscription's, for Claude Code alone — would be refused for this
   * harness, so it is not listed. */
  it("leaves out a model kept to named harnesses", () => {
    const ibm = provider("ibm", ["azure/gpt-5.5", "aws/claude-opus-5-5"]);
    ibm.entries[1] = { ...ibm.entries[1]!, harnesses: ["claude-code"] };
    expect(unboundHarnessModels([ibm]).map((m) => m.name)).toEqual([
      "ibm/azure/gpt-5.5",
    ]);
  });

  /** TEST_SCENARIO: An agent with no provider gets an empty list. */
  it("lists nothing without a provider", () => {
    expect(unboundHarnessModels([])).toEqual([]);
  });
});
