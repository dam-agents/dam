import type { HarnessView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  grantedProviderRefs,
  harnessOptions,
  nextPair,
  providerOptions,
} from "../../modules/sessions/lib/session-pair-options.js";

const CATALOG: HarnessView[] = [
  {
    name: "claude-code",
    displayName: "Claude",
    providers: ["ibm-litellm", "anthropic"],
    tags: [],
    experimental: false,
  },
  {
    name: "codex",
    displayName: "Codex",
    providers: ["ibm-litellm", "openai"],
    tags: [],
    experimental: false,
  },
];

const lite = { id: "lite", name: "LiteLLM", type: "ibm-litellm" as const };
const oai = { id: "oai", name: "OpenAI", type: "openai" as const };
const claude = { id: "claude", name: "Anthropic", type: "anthropic" as const };

describe("session pair options", () => {
  it("keeps Anthropic OAuth out of Pi's granted and addable providers", () => {
    const { granted, owned } = grantedProviderRefs(
      ["oauth"],
      [
        { id: "oauth", name: "OAuth", templateId: "anthropic-oauth" },
        { id: "key", name: "API key", templateId: "anthropic" },
      ],
    );
    const catalog: HarnessView[] = [
      ...CATALOG,
      {
        name: "pi",
        displayName: "Pi",
        providers: ["anthropic"],
        tags: [],
        experimental: false,
      },
    ];
    expect(providerOptions("pi", catalog, granted, owned)).toEqual({
      granted: [],
      addable: [owned[1]],
    });
    expect(providerOptions("pi", catalog, [], owned)).toEqual({
      granted: [],
      addable: [owned[1]],
    });
    expect(providerOptions("claude-code", catalog, granted, owned)).toEqual({
      granted,
      addable: [owned[1]],
    });
  });

  /** TEST_SCENARIO: The picker names the harnesses the agent's runtime
   * carries, by the catalog's display name. */
  it("offers the carried harnesses by name", () => {
    expect(harnessOptions(["codex", "mock"], CATALOG)).toEqual([
      { name: "codex", displayName: "Codex" },
      { name: "mock", displayName: "mock" },
    ]);
  });

  /** TEST_SCENARIO: Codex offers models from granted providers it can run
   * on, and a "+" for each owned provider Connection it could run on that the
   * agent does not hold yet. */
  it("splits a harness's providers into granted and addable", () => {
    expect(
      providerOptions("codex", CATALOG, [lite, claude], [lite, claude, oai]),
    ).toEqual({ granted: [lite], addable: [oai] });
  });

  /** TEST_SCENARIO: A remembered pair on a harness the agent no longer
   * carries preselects nothing. */
  it("drops a pair whose harness the agent does not carry", () => {
    const pair = { harness: "bob", provider: "lite", model: null };
    const fits = () => ["lite"];
    expect(nextPair(null, pair, ["claude-code"], fits)).toBeNull();
    expect(nextPair(null, pair, ["bob"], fits)).toEqual(pair);
  });

  /** TEST_SCENARIO: The provider of the pair a person picked was removed
   * since. The next session moves to a provider still granted that the
   * harness fits, without the old model, instead of asking for the removed
   * provider and being refused. */
  it("moves a pair off a removed provider, dropping its model", () => {
    const chosen = { harness: "codex", provider: "gone", model: "gpt-5" };
    expect(nextPair(chosen, null, ["codex"], () => ["oai"])).toEqual({
      harness: "codex",
      provider: "oai",
      model: null,
    });
  });

  /** TEST_SCENARIO: The harness a person picked has no granted provider it
   * can run on, so the remembered pair still decides, rather than the
   * runtime running that harness on a provider it cannot use. */
  it("falls back to the remembered pair when the pick has no fitting provider", () => {
    const chosen = { harness: "codex", provider: null, model: null };
    const remembered = {
      harness: "claude-code",
      provider: "lite",
      model: null,
    };
    const fits = (h: string) => (h === "codex" ? [] : ["lite"]);
    expect(
      nextPair(chosen, remembered, ["codex", "claude-code"], fits),
    ).toEqual(remembered);
  });
});
