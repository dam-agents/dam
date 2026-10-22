/**
 * TEST_OVERVIEW: The platform's model preference list decides two things a
 * provider's Connection cannot: which model a new agent runs when nobody
 * picked one, and which model Claude Code's permission classifier runs on. Its
 * matcher folds the spellings providers use for the same model and refuses a
 * different version, so a listing that holds only an older model falls through
 * instead of running on it unseen.
 */
import { describe, expect, it } from "vitest";
import {
  modelMatches,
  modelTokens,
  PREFERRED_MODELS,
  preferredModelOf,
} from "api-server-api";

const entry = (family: string) =>
  PREFERRED_MODELS.find(
    (pref) => pref.family[pref.family.length - 1] === family,
  )!;
const matches = (id: string, family: string) =>
  modelMatches(modelTokens(id), entry(family));

describe("the preferred model matcher", () => {
  // TEST_SCENARIO: providers prefix a deployment, vary the case and separate a version with a dot, a dash or an underscore, and Claude Code adds [1m]; all of those name one model, while another version names another.
  it("folds the spellings of one model and refuses another version", () => {
    for (const id of [
      "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
      "deepseek-v4.1-flash",
      "deepseek_4_1_flash",
    ])
      expect(matches(id, "deepseek")).toBe(true);
    expect(matches("rits/deepseek-ai/DeepSeek-V3.2", "deepseek")).toBe(false);
    expect(matches("rits/deepseek-ai/DeepSeek-V4.1-Base", "deepseek")).toBe(
      false,
    );
    for (const id of [
      "aws/claude-opus-5-5",
      "claude-opus-5.5",
      "anthropic/Claude-Opus-5-5[1m]",
    ])
      expect(matches(id, "opus")).toBe(true);
    expect(matches("aws/claude-opus-4-8", "opus")).toBe(false);
    expect(matches("gpt-6.1-sol", "gpt")).toBe(true);
    expect(matches("gpt-5.5", "gpt")).toBe(false);
    expect(matches("gpt-6.1-nano", "gpt")).toBe(false);
    expect(matches("gpt-6.1-mini", "gpt")).toBe(false);
    expect(matches("nis/nvidia/NVIDIA-Nemotron-3-Ultra-550B", "nemotron")).toBe(
      true,
    );
    expect(matches("nemotron-4", "nemotron")).toBe(false);
    expect(
      matches("rits/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nemotron"),
    ).toBe(false);
  });

  // TEST_SCENARIO: the version must be the model's own, right behind its family, so a longer version that contains the listed digits is not a match and no model is mistaken for a newer one.
  it("reads the version that belongs to the family, not one inside it", () => {
    expect(matches("gpt-5-6-1", "gpt")).toBe(false);
    expect(matches("claude-opus-4-5-5", "opus")).toBe(false);
    expect(matches("aws/claude-sonnet-5-5-20260101", "sonnet")).toBe(true);
    expect(matches("aws/claude-opus-5-5-fast", "opus")).toBe(false);
    expect(matches("aws/claude-sonnet-4-6", "sonnet")).toBe(false);
  });
});

describe("preferredModelOf", () => {
  const cb = {
    alias: "cb",
    listed: [
      "rits/zai-org/glm-5-4",
      "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4",
      "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    ],
  };
  const anthropic = {
    alias: "anthropic",
    listed: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
  };

  // TEST_SCENARIO: the list's order beats the provider order, so an agent holding both Anthropic and CurveBender starts on DeepSeek; within one entry the providers' own order decides, and a provider that lists neither is passed over.
  it("takes the list's order across providers, then the providers' order", () => {
    expect(preferredModelOf("work", [anthropic, cb])).toEqual({
      alias: "cb",
      upstreamId: "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    });
    expect(preferredModelOf("work", [cb, anthropic])).toEqual({
      alias: "cb",
      upstreamId: "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    });
    expect(
      preferredModelOf("work", [
        { alias: "ibm", listed: ["gpt-5.5"] },
        anthropic,
      ]),
    ).toEqual({ alias: "anthropic", upstreamId: "claude-opus-5-5" });
  });

  // TEST_SCENARIO: the classifier role has its own order — Nemotron before Claude's Sonnet — and a provider that lists nothing on either list gets null, which leaves the caller its own last resort.
  it("resolves the classifier role on its own list", () => {
    expect(preferredModelOf("classifier", [cb])).toEqual({
      alias: "cb",
      upstreamId: "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4",
    });
    expect(preferredModelOf("classifier", [anthropic])).toEqual({
      alias: "anthropic",
      upstreamId: "claude-sonnet-5-5",
    });
    expect(
      preferredModelOf("classifier", [{ alias: "x", listed: ["qwen-9"] }]),
    ).toBeNull();
    expect(
      preferredModelOf("classifier", [
        {
          alias: "cb",
          listed: [
            "rits/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
            "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4",
          ],
        },
      ]),
    ).toEqual({
      alias: "cb",
      upstreamId: "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4",
    });
    expect(preferredModelOf("work", [])).toBeNull();
  });
});
