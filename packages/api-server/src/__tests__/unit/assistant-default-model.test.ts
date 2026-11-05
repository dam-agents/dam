// TEST_OVERVIEW: An assistant provisioned without a bound Default profile has no saved model, so its first hello converts one from what its harness prefers. Since #6310 that preference is read per harness: an assistant on Pi takes the model every install serves — DeepSeek V4.1 Flash on the shared CurveBender — and never a Claude Code agent's Opus that the same providers also list, while a Claude Code agent on the same providers still gets Opus. A "not set" is retried on later hellos, and the retry reads the same harness.
import { describe, expect, it } from "vitest";
import { convertedDefaultModel } from "../../modules/harness-config/domain/default-conversion.js";

const DEEPSEEK = "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017";
const OPUS = "aws/claude-opus-5-5";
const SHARED = [{ alias: "cb", listed: [DEEPSEEK, OPUS] }];

/** UNIT_BOUNDARY_DESCRIPTION: what the conversion is handed for an assistant whose create bound no profile: its spec harness, no setting, no history, and the providers it was granted. */
const converted = (harness: string, providers = SHARED) =>
  convertedDefaultModel({ harness, setting: null, providers, ran: [] });

describe("an assistant's default model without a bound profile", () => {
  // TEST_SCENARIO: on Pi, with a provider listing both DeepSeek and Opus, the assistant takes DeepSeek — Pi names no model of its own, so the platform's own model answers before any other harness's — and a Claude Code agent on the same listing takes Opus, which is the harness rule at work.
  it("takes Pi's preference, not another harness's model", () => {
    expect(converted("pi")).toBe(`cb/${DEEPSEEK}`);
    expect(converted("claude-code")).toBe(`cb/${OPUS}`);
  });

  // TEST_SCENARIO: the retry of a "not set" default reads the harness again, so an assistant whose conversion found nothing earlier fills with the same model once a provider lists it.
  it("fills a retried not-set with the same model", () => {
    expect(converted("pi", [{ alias: "cb", listed: [] }])).toBeNull();
    expect(converted("pi")).toBe(`cb/${DEEPSEEK}`);
  });

  // TEST_SCENARIO: another harness's model answers only where no provider serves the platform's own, so an assistant on Pi still gets a model from a provider that lists only Claude's.
  it("falls back to another harness's model only when nothing else is listed", () => {
    expect(converted("pi", [{ alias: "cb", listed: [OPUS] }])).toBe(
      `cb/${OPUS}`,
    );
  });
});
