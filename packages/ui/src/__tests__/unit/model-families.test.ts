import type { CatalogModelView } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import type { ModelGroup } from "../../modules/sessions/lib/catalog-groups.js";
import {
  compareVersions,
  familyModelGroups,
  parseModelFamily,
} from "../../modules/sessions/lib/model-families.js";

// TEST_OVERVIEW: The model menu recognises a model by family and size tier, ignoring the gateway prefixes and the version in its id, so it can show one entry per size on the newest version and put older and unrecognised versions behind More. Every other model stays selectable, under its family's More or under Other.

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

  // TEST_SCENARIO: A name that only looks like a family model is not one: a variant after the size and a size word in the middle stay distinct models.
  it("rejects a name of another shape", () => {
    expect(parseModelFamily("gpt-6.1-sol-mini")).toBeNull();
    expect(parseModelFamily("gpt-6.1-custom-sol-adapter")).toBeNull();
    expect(parseModelFamily("claude-opus-5-5-mini")).toBeNull();
  });

  // TEST_SCENARIO: A snapshot date after the version is kept apart from it, so the dated snapshot is the same version and not a newer one.
  it("reads a snapshot date apart from the version", () => {
    expect(parseModelFamily("claude-opus-5-5-20261001")).toMatchObject({
      size: "opus",
      version: [5, 5],
      snapshotDate: "20261001",
    });
    expect(parseModelFamily("claude-3-5-sonnet-20241022")).toMatchObject({
      size: "sonnet",
      version: [3, 5],
      snapshotDate: "20241022",
    });
  });

  // TEST_SCENARIO: Versions compare numerically, so 5.5 beats 5.1, 5.1 beats 5, and 5.10 beats 5.9.
  it("orders versions numerically", () => {
    expect(compareVersions([5, 5], [5, 1])).toBeGreaterThan(0);
    expect(compareVersions([5, 1], [5])).toBeGreaterThan(0);
    expect(compareVersions([4, 8], [5])).toBeLessThan(0);
    expect(
      compareVersions(
        parseModelFamily("gpt-5.10-sol")!.version,
        parseModelFamily("gpt-5.9-sol")!.version,
      ),
    ).toBeGreaterThan(0);
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
      "ibm/azure/gpt-5.5",
      "ibm/rits/deepseek-ai/DeepSeek-V3.2",
    ),
    group(
      "anthropic",
      "anthropic/claude-opus-5-5",
      "anthropic/claude-haiku-4-5",
    ),
    group("curve", "cb/gpt-5.6-sol", "cb/rits/zai-org/glm-5-3"),
  ];

  // TEST_SCENARIO: Collapsed, one entry per size, largest size first, the newest version on the entry. Open, the whole family is ordered by version newest first, then by size largest first.
  it("keeps the newest version of each size and hides the rest", () => {
    const { families } = familyModelGroups(groups);
    const claude = families.find((s) => s.family.name === "Claude")!;
    expect(claude.newest.map((e) => e.label)).toEqual([
      "Opus 5.5",
      "Sonnet 5.5",
      "Haiku 4.5",
    ]);
    expect(claude.more.map((e) => e.label)).toEqual(["Opus 5.1"]);
    expect(claude.expanded.map((e) => e.label)).toEqual([
      "Opus 5.5",
      "Sonnet 5.5",
      "Opus 5.1",
      "Haiku 4.5",
    ]);
  });

  // TEST_SCENARIO: With More open, a lower version of a larger size follows every entry of a newer version, and sizes sort largest first within one version.
  it("orders the open family by version first, then by size", () => {
    const { families } = familyModelGroups([
      group(
        "ibm",
        "ibm/claude-opus-5-5",
        "ibm/claude-sonnet-5",
        "ibm/claude-haiku-5",
        "ibm/claude-opus-4-8",
      ),
    ]);
    const claude = families[0]!;
    expect(claude.newest.map((e) => e.label)).toEqual([
      "Opus 5.5",
      "Sonnet 5",
      "Haiku 5",
    ]);
    expect(claude.expanded.map((e) => e.label)).toEqual([
      "Opus 5.5",
      "Sonnet 5",
      "Haiku 5",
      "Opus 4.8",
    ]);
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

  // TEST_SCENARIO: A model of a known family whose size or variant is not recognised goes behind that family's More, not into Other.
  it("hides a known family's unrecognised model behind More", () => {
    const { families, other } = familyModelGroups(groups);
    const gpt = families.find((s) => s.family.name === "GPT")!;
    expect(gpt.more.map((e) => e.label)).toEqual(["azure/gpt-5.5"]);
    expect(gpt.more[0]!.options[0]!.model.name).toBe("ibm/azure/gpt-5.5");
    expect(other.models.some((e) => e.label === "azure/gpt-5.5")).toBe(false);
  });

  // TEST_SCENARIO: Models of no known family are their own entries under Other, grouped by upstream id across providers.
  it("puts an unknown family under Other", () => {
    const { other } = familyModelGroups([
      ...groups,
      group("other-provider", "x/rits/deepseek-ai/DeepSeek-V3.2"),
    ]);
    expect(other.models.map((e) => e.label)).toEqual([
      "rits/deepseek-ai/DeepSeek-V3.2",
      "rits/zai-org/glm-5-3",
    ]);
    const deepseek = other.models[0]!;
    expect(deepseek.options.map((o) => o.group.connectionId)).toEqual([
      "ibm",
      "other-provider",
    ]);
  });

  // TEST_SCENARIO: A provider that listed nothing is kept for its listing state.
  it("keeps an unlisted provider for its state", () => {
    const { other } = familyModelGroups([
      ...groups,
      { ...group("openai"), status: "unavailable" },
    ]);
    expect(other.unlisted.map((g) => g.connectionId)).toEqual(["openai"]);
  });

  // TEST_SCENARIO: A variant name and a fully named model from one provider are two selectable models, not one dropped by the other.
  it("keeps a variant beside the model it resembles", () => {
    const { families } = familyModelGroups([
      group("ibm", "ibm/gpt-6.1-sol", "ibm/gpt-6.1-sol-mini"),
    ]);
    const gpt = families[0]!;
    expect(gpt.newest[0]!.options.map((o) => o.model.name)).toEqual([
      "ibm/gpt-6.1-sol",
    ]);
    expect(gpt.more.map((e) => e.label)).toEqual(["gpt-6.1-sol-mini"]);
    expect(gpt.more[0]!.options[0]!.model.name).toBe("ibm/gpt-6.1-sol-mini");
  });

  // TEST_SCENARIO: An undated model and the dated snapshot of the same version are one entry with both providers, and no dated version appears.
  it("merges a snapshot of the same version with its base version", () => {
    const { families } = familyModelGroups([
      group("ibm", "ibm/aws/claude-opus-5-5"),
      group("anthropic", "anthropic/claude-opus-5-5-20261001"),
    ]);
    const claude = families[0]!;
    expect(claude.newest.map((e) => e.label)).toEqual(["Opus 5.5"]);
    expect(claude.more).toEqual([]);
    expect(claude.newest[0]!.options.map((o) => o.model.name)).toEqual([
      "ibm/aws/claude-opus-5-5",
      "anthropic/claude-opus-5-5-20261001",
    ]);
  });

  // TEST_SCENARIO: A provider that lists its base model and its dated snapshot keeps both names selectable.
  it("keeps a second snapshot name of the same provider selectable", () => {
    const { families } = familyModelGroups([
      group(
        "ibm",
        "ibm/aws/claude-opus-5-5",
        "ibm/aws/claude-opus-5-5-20261001",
      ),
    ]);
    expect(families[0]!.newest[0]!.options.map((o) => o.model.name)).toEqual([
      "ibm/aws/claude-opus-5-5",
    ]);
    expect(families[0]!.more.map((e) => e.label)).toEqual([
      "aws/claude-opus-5-5-20261001",
    ]);
  });
});
