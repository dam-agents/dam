import type { CatalogModelView } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import type { ModelGroup } from "../../modules/sessions/lib/catalog-groups.js";
import {
  compareVersions,
  familyModelGroups,
  parseModelFamily,
} from "../../modules/sessions/lib/model-families.js";

// TEST_OVERVIEW: The model menu recognises a model by family and size tier, ignoring the gateway prefixes and the version in its id, so it can show one entry per size on the newest version and put the older versions behind More.

const model = (name: string): CatalogModelView => ({
  name,
  upstreamId: name.slice(name.indexOf("/") + 1),
  contextWindow: null,
  maxOutputTokens: null,
  reasoning: null,
  vision: null,
  prices: null,
  source: { limits: "none", prices: "none" },
});

const group = (connectionId: string, ...names: string[]): ModelGroup => ({
  connectionId,
  alias: connectionId,
  displayName: connectionId,
  status: "listed",
  listedAt: null,
  native: false,
  models: names.map(model),
});

describe("a model id's family, size and version", () => {
  // TEST_SCENARIO: Claude sizes sit before the version and GPT sizes after it; both parse, with the version read as numbers.
  it("reads the size and version of each known family", () => {
    expect(parseModelFamily("claude-opus-5-5")).toMatchObject({
      size: "opus",
      version: [5, 5],
    });
    expect(parseModelFamily("claude-opus-5-1")?.version).toEqual([5, 1]);
    expect(parseModelFamily("gpt-6.1-sol")).toMatchObject({
      family: { name: "GPT" },
      size: "sol",
      version: [6, 1],
    });
  });

  // TEST_SCENARIO: A gateway's path prefix, Claude Code's own prefix and Bedrock's dotted prefix are all ignored.
  it("ignores provider prefixes", () => {
    expect(parseModelFamily("ibm/aws/claude-opus-5-5")).toMatchObject({
      size: "opus",
      version: [5, 5],
    });
    expect(parseModelFamily("claude/ibm/aws/claude-sonnet-4-6")?.size).toBe(
      "sonnet",
    );
    expect(parseModelFamily("eu.anthropic.claude-opus-4-8")?.version).toEqual([
      4, 8,
    ]);
    expect(parseModelFamily("azure/gpt-5.6-terra")?.size).toBe("terra");
  });

  // TEST_SCENARIO: A model of no known family, or of a known family with no size, is not a family model.
  it("returns null for an unknown model", () => {
    expect(parseModelFamily("rits/zai-org/glm-5-3")).toBeNull();
    expect(parseModelFamily("rits/deepseek-ai/DeepSeek-V3.2")).toBeNull();
    expect(parseModelFamily("azure/gpt-5.5")).toBeNull();
  });

  // TEST_SCENARIO: Versions compare numerically, so 5.5 beats 5.1 and 5.1 beats 5.
  it("orders versions numerically", () => {
    expect(compareVersions([5, 5], [5, 1])).toBeGreaterThan(0);
    expect(compareVersions([5, 1], [5])).toBeGreaterThan(0);
    expect(compareVersions([4, 8], [5])).toBeLessThan(0);
  });
});

describe("the menu's family groups", () => {
  const groups = [
    group(
      "ibm",
      "ibm/aws/claude-opus-5-5",
      "ibm/aws/claude-opus-5-1",
      "ibm/aws/claude-sonnet-5-5",
      "ibm/azure/gpt-5.6-sol",
      "ibm/rits/deepseek-ai/DeepSeek-V3.2",
    ),
    group(
      "anthropic",
      "anthropic/claude-opus-5-5",
      "anthropic/claude-haiku-4-5",
    ),
    group("curve", "cb/gpt-5.6-sol", "cb/rits/zai-org/glm-5-3"),
  ];

  // TEST_SCENARIO: One entry per size, largest size first, the newest version on the entry and the older one behind More.
  it("keeps the newest version of each size and hides the rest", () => {
    const { families } = familyModelGroups(groups);
    const claude = families.find((s) => s.family.name === "Claude")!;
    expect(claude.newest.map((e) => e.label)).toEqual([
      "Opus 5.5",
      "Sonnet 5.5",
      "Haiku 4.5",
    ]);
    expect(claude.older.map((e) => e.label)).toEqual(["Opus 5.1"]);
  });

  // TEST_SCENARIO: The same model listed by two providers is one entry with both providers as options, in catalog order.
  it("merges the providers that offer the same model", () => {
    const { families } = familyModelGroups(groups);
    const opus = families
      .find((s) => s.family.name === "Claude")!
      .newest.find((e) => e.label === "Opus 5.5")!;
    expect(opus.options.map((o) => o.group.connectionId)).toEqual([
      "ibm",
      "anthropic",
    ]);
    const sol = families
      .find((s) => s.family.name === "GPT")!
      .newest.find((e) => e.label === "Sol 5.6")!;
    expect(sol.options.map((o) => o.group.displayName)).toEqual([
      "ibm",
      "curve",
    ]);
  });

  // TEST_SCENARIO: Models of no known family keep their provider's group for the bottom of the menu, and a provider that listed nothing is kept for its listing state.
  it("leaves unknown models and unlisted providers for the bottom", () => {
    const { leftovers } = familyModelGroups([
      ...groups,
      { ...group("openai"), status: "unavailable" },
    ]);
    expect(
      leftovers.map((l) => [
        l.group.connectionId,
        l.models.map((m) => m.upstreamId),
      ]),
    ).toEqual([
      ["ibm", ["rits/deepseek-ai/DeepSeek-V3.2"]],
      ["curve", ["rits/zai-org/glm-5-3"]],
      ["openai", []],
    ]);
  });
});
