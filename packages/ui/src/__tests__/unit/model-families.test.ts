import type { CatalogModelView } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import type { ModelGroup } from "../../modules/sessions/lib/catalog-groups.js";
import {
  compareVersions,
  familyModelGroups,
  parseModelFamily,
  prettyModelLabel,
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
  attached: true,
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
    expect(parseModelFamily("azure/gpt-5.5")).toMatchObject({
      family: { name: "GPT" },
      size: "gpt",
      version: [5, 5],
    });
  });

  // TEST_SCENARIO: A model of no known family, or of a known family with no size, is not a family model.
  it("returns null for an unknown model", () => {
    expect(parseModelFamily("meta/llama-4")).toBeNull();
    expect(parseModelFamily("rits/moonshotai/Kimi-Latest")).toBeNull();
  });

  // TEST_SCENARIO: GLM's ids carry no size word, so the family is one tier; DeepSeek's carry Flash, and the v in its version is not part of it.
  it("reads a family with no size word and a v-marked version", () => {
    expect(parseModelFamily("rits/zai-org/glm-5-3")).toMatchObject({
      family: { name: "GLM" },
      size: "glm",
      version: [5, 3],
    });
    expect(
      parseModelFamily("rits/deepseek-ai/DeepSeek-V4.1-Flash"),
    ).toMatchObject({
      family: { name: "DeepSeek" },
      size: "flash",
      version: [4, 1],
    });
    expect(parseModelFamily("rits/deepseek-ai/DeepSeek-V3.2")).toMatchObject({
      family: { name: "DeepSeek" },
      size: "deepseek",
      version: [3, 2],
    });
  });

  // TEST_SCENARIO: A name that only looks like a family model is not one: a variant after the size and a size word in the middle stay distinct models.
  it("rejects a name of another shape", () => {
    expect(parseModelFamily("gpt-6.1-sol-mini")).toBeNull();
    expect(parseModelFamily("gpt-6.1-custom-sol-adapter")).toBeNull();
    expect(parseModelFamily("claude-opus-5-5-mini")).toBeNull();
  });

  // TEST_SCENARIO: Nemotron's variant tail after its size is not a version, and Bob's service tiers are fixed names, not versions.
  it("reads Nemotron's variant tail and Bob's named tiers", () => {
    expect(
      parseModelFamily("rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4"),
    ).toMatchObject({
      family: { name: "Nemotron" },
      size: "ultra",
      version: [3],
    });
    expect(parseModelFamily("bob/premium-ide")).toMatchObject({
      family: { name: "Bob" },
      size: "premium-ide",
      version: [],
    });
    expect(parseModelFamily("bob/wxO-model")?.size).toBe("wxO-model");
    expect(parseModelFamily("nemotron-ultra-3")).toMatchObject({
      size: "ultra",
      version: [3],
    });
    expect(parseModelFamily("nvidia/NVIDIA-Nemotron-Ultra")).toBeNull();
  });

  // TEST_SCENARIO: A build stamp after the version, a snapshot date or a build number, is kept apart from it, so a stamped model is the same version and not a newer one.
  it("reads a build stamp apart from the version", () => {
    expect(parseModelFamily("claude-opus-5-5-20261001")).toMatchObject({
      size: "opus",
      version: [5, 5],
      buildStamp: "20261001",
    });
    expect(parseModelFamily("claude-3-5-sonnet-20241022")).toMatchObject({
      size: "sonnet",
      version: [3, 5],
      buildStamp: "20241022",
    });
    expect(
      parseModelFamily("rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"),
    ).toMatchObject({
      size: "flash",
      version: [4, 1],
      buildStamp: "1017",
    });
  });

  // TEST_SCENARIO: a variant after the version, such as GPT's mini, reads as part of the friendly name, so it never shows the raw id.
  it("names a variant of a version", () => {
    expect(prettyModelLabel("gpt-5-5-mini")).toBe("GPT 5.5 mini");
    expect(parseModelFamily("gpt-5-5-mini")).toMatchObject({
      size: "gpt",
      version: [5, 5],
      variant: "mini",
    });
  });

  // TEST_SCENARIO: The chat names a matched model by family and size, not by its provider, and has no pretty name for an unmatched one.
  it("names a matched model for the chat", () => {
    expect(prettyModelLabel("ibm/aws/claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(prettyModelLabel("cb/rits/zai-org/glm-5-3")).toBe("GLM 5.3");
    expect([
      prettyModelLabel("rits/ibm-research/granite-5.0-230b-preview-r261008a"),
      prettyModelLabel("rits/meta-models/Muse-Spark-Open-816B-A42B-NVFP4"),
      prettyModelLabel("meta/muse-spark-1.1"),
      prettyModelLabel("ibm/granite-3.0-8b-instruct"),
    ]).toEqual([
      "Granite 5.0 230B",
      "Muse Spark 816B",
      "Muse Spark 1.1",
      "Granite 3.0 8B",
    ]);
    expect(prettyModelLabel("bob/premium-ide")).toBe("Bob premium-ide");
    expect(prettyModelLabel("azure/gpt-5.5")).toBe("GPT 5.5");
  });

  // TEST_SCENARIO: a variant and the plain model are distinct entries, while the same model on two providers is one entry with both.
  it("keeps a variant distinct and one model on two providers together", () => {
    const { families } = familyModelGroups([
      group("ibm", "ibm/gpt-5-5", "ibm/gpt-5-5-mini"),
      group("curve", "curve/gpt-5-5"),
    ]);
    const gpt = families.find((section) => section.family.token === "gpt")!;
    expect(gpt.expanded.map((entry) => entry.label)).toEqual([
      "5.5",
      "5.5 mini",
    ]);
    expect(gpt.expanded.map((entry) => entry.options.length)).toEqual([2, 1]);
    expect(gpt.newest).toEqual([]);
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
    group(
      "curve",
      "cb/gpt-5.6-sol",
      "cb/rits/zai-org/glm-5-3",
      "cb/rits/zai-org/glm-5-4",
      "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash",
    ),
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
  it("keeps a tierless version behind More", () => {
    const { families } = familyModelGroups(groups);
    const gpt = families.find((s) => s.family.name === "GPT")!;
    expect(gpt.more.map((e) => e.label)).toEqual(["5.5"]);
    expect(gpt.more[0]!.options[0]!.model.name).toBe("ibm/azure/gpt-5.5");
  });

  // TEST_SCENARIO: GLM has no size word, so it is one tier: the newest version collapsed and the older ones behind More. DeepSeek's Flash is its size and its unworded V3.2 sits behind More.
  it("groups the single-tier GLM and DeepSeek families", () => {
    const { families } = familyModelGroups(groups);
    const glm = families.find((s) => s.family.name === "GLM")!;
    expect(glm.newest.map((e) => e.label)).toEqual(["5.4"]);
    expect(glm.more.map((e) => e.label)).toEqual(["5.3"]);
    const deepseek = families.find((s) => s.family.name === "DeepSeek")!;
    expect(deepseek.newest.map((e) => e.label)).toEqual(["Flash 4.1"]);
    expect(deepseek.more.map((e) => e.label)).toEqual(["3.2"]);
  });

  // TEST_SCENARIO: Nemotron's Nano is one entry, and Bob's tiers, the dev-sec-ops ones and ultra among them, form their own group in the given order; gpt-oss keeps the GPT family and its More.
  it("groups Nemotron and Bob", () => {
    const { families, other } = familyModelGroups([
      group("cb", "cb/rits/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"),
      group(
        "bob",
        "bob/background",
        "bob/ultra",
        "bob/premium-ide",
        "bob/dev-sec-ops-premium-west",
        "bob/wxO-model",
        "bob/dev-sec-ops-premium",
        "bob/gpt-oss-20b",
      ),
    ]);
    expect(
      families
        .find((f) => f.family.name === "Nemotron")!
        .newest.map((e) => e.label),
    ).toEqual(["Nano 3 30B"]);
    const bob = families.find((f) => f.family.name === "Bob")!;
    expect(bob.newest.map((e) => e.label)).toEqual([
      "background",
      "dev-sec-ops-premium",
      "dev-sec-ops-premium-west",
      "premium-ide",
      "ultra",
      "wxO-model",
    ]);
    expect(other.models).toEqual([]);
    expect(bob.more).toEqual([]);
    expect(
      families.find((f) => f.family.name === "GPT")!.more.map((e) => e.label),
    ).toContain("gpt-oss-20b");
  });

  // TEST_SCENARIO: Models of no known family are their own entries under Other, grouped by upstream id across providers.
  it("puts an unknown family under Other", () => {
    const { other } = familyModelGroups([
      ...groups,
      group("other-provider", "x/meta/llama-4"),
    ]);
    expect(other.models.map((e) => e.label)).toEqual(["meta/llama-4"]);
    const llama = other.models[0]!;
    expect(llama.options.map((o) => o.group.connectionId)).toEqual([
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

  // TEST_SCENARIO: A second recognized name for a version the provider already lists is that model, so it is not shown again.
  it("absorbs a second recognized name for the same version", () => {
    const { families } = familyModelGroups([
      group(
        "ibm",
        "ibm/aws/claude-opus-5-5",
        "ibm/aws/claude-opus-5-5-20261001",
        "ibm/claude-opus-4-8",
        "ibm/aws/claude-opus-4-8",
      ),
    ]);
    const claude = families.find((f) => f.family.name === "Claude")!;
    expect(claude.newest[0]!.options.map((o) => o.model.name)).toEqual([
      "ibm/aws/claude-opus-5-5",
    ]);
    const opus48 = claude.more.find((e) => e.label === "Opus 4.8")!;
    expect(opus48.options.map((o) => o.model.name)).toEqual([
      "ibm/claude-opus-4-8",
    ]);
    expect(claude.more.map((e) => e.label)).toEqual(["Opus 4.8"]);
  });

  // TEST_SCENARIO: The models QA found under Other as raw ids get family names: Gemini by size then version, a preview as its variant, Kimi with the K its vendor writes on the version; the next model of each vendor parses the same way.
  it("names Gemini and Kimi models", () => {
    expect([
      prettyModelLabel("ibm/gcp/gemini-3.1-pro-preview"),
      prettyModelLabel("ibm/gcp/gemini-4-argon"),
      prettyModelLabel("ibm/gemini-4-argon"),
      prettyModelLabel("ibm/rits/moonshotai/Kimi-K2.5"),
      prettyModelLabel("gemini-5-flash"),
      prettyModelLabel("kimi-k3"),
    ]).toEqual([
      "Gemini Pro 3.1 preview",
      "Gemini Argon 4",
      "Gemini Argon 4",
      "Kimi K2.5",
      "Gemini Flash 5",
      "Kimi K3",
    ]);
  });

  // TEST_SCENARIO: A preview and the released model of the same version are two entries, and the released one is the newest in either listing order; a fixed Bob name with a preview tail is no Bob tier.
  it("puts a released model ahead of its preview", () => {
    for (const ids of [
      ["ibm/gemini-3.1-pro-preview", "ibm/gemini-3.1-pro"],
      ["ibm/gemini-3.1-pro", "ibm/gemini-3.1-pro-preview"],
    ]) {
      const gemini = familyModelGroups([group("ibm", ...ids)]).families[0]!;
      expect(gemini.newest.map((e) => e.label)).toEqual(["Pro 3.1"]);
      expect(gemini.more.map((e) => e.label)).toEqual(["Pro 3.1 preview"]);
    }
    expect(parseModelFamily("bob/premium-preview")).toBeNull();
  });

  // TEST_SCENARIO: IBM ETE lists Gemini 4 Argon twice, as gcp/gemini-4-argon and gemini-4-argon; the menu shows it once, and nothing of that listing stays under Other.
  it("shows IBM's two Gemini 4 Argon ids as one model", () => {
    const { families, other } = familyModelGroups([
      group(
        "ibm",
        "ibm/gcp/gemini-3.1-pro-preview",
        "ibm/gcp/gemini-4-argon",
        "ibm/gemini-4-argon",
        "ibm/rits/moonshotai/Kimi-K2.5",
      ),
    ]);
    expect(other.models).toEqual([]);
    const gemini = families.find((f) => f.family.name === "Gemini")!;
    expect(gemini.newest.map((e) => e.label)).toEqual([
      "Argon 4",
      "Pro 3.1 preview",
    ]);
    expect(gemini.newest[0]!.options.map((o) => o.model.name)).toEqual([
      "ibm/gcp/gemini-4-argon",
    ]);
    expect(
      families
        .find((f) => f.family.name === "Kimi")!
        .newest.map((e) => e.label),
    ).toEqual(["K2.5"]);
  });

  // TEST_SCENARIO: CurveBender's Nemotron serves the platform's classifier only, so no menu offers it, while a pick saved before keeps its name.
  it("offers no internal model", () => {
    const nemotron = "cb/rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4";
    const { families, other } = familyModelGroups([
      group("cb", nemotron, "cb/rits/zai-org/glm-5-3"),
    ]);
    expect(families.map((f) => f.family.name)).toEqual(["GLM"]);
    expect(other.models).toEqual([]);
    expect(prettyModelLabel(nemotron)).toBe("Nemotron Ultra 3 550B");
  });
});
