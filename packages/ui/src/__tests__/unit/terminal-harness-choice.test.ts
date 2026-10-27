// TEST_OVERVIEW: what a new web terminal offers. While the agent's harnesses, the harness catalog or the provider grants load, nothing is offered, so no harness is left out by mistake. A failed load or an agent naming no harness falls back to one plain terminal. Otherwise exactly the carried harnesses that can start are offered: each with the first granted provider that fits it, else the providers the owner holds that the agent could take, leaving out one of a kind it already holds. A harness no provider fits is not offered.
import type { HarnessView } from "api-server-api";
import { describe, expect, it } from "vitest";

import { attachableProviders } from "../../modules/sessions/lib/catalog-groups.js";
import { terminalHarnessChoice } from "../../modules/sessions/lib/session-pair-options.js";

const CATALOG: HarnessView[] = [
  {
    name: "claude-code",
    displayName: "Claude",
    providers: ["anthropic"],
    tags: [],
    experimental: false,
  },
  {
    name: "codex",
    displayName: "Codex",
    providers: ["openai"],
    tags: [],
    experimental: false,
  },
];

const anthropic = { id: "a", name: "Anthropic", type: "anthropic" as const };
const openai = { id: "o", name: "OpenAI", type: "openai" as const };

const base = {
  loading: false,
  failed: false,
  carried: ["claude-code", "codex"],
  catalog: CATALOG,
  granted: [anthropic],
  owned: [anthropic],
};

describe("terminalHarnessChoice", () => {
  // TEST_SCENARIO: a still-loading query shows nothing, even when a failure was already seen elsewhere.
  it("shows nothing while anything loads", () => {
    expect(terminalHarnessChoice({ ...base, loading: true })).toEqual({
      kind: "loading",
    });
  });

  // TEST_SCENARIO: a failed query, a missing catalog or an agent with no harness keeps one plain terminal instead of hiding the entry point.
  it.each([
    ["a failed load", { failed: true }],
    ["no catalog", { catalog: undefined }],
    ["no harness", { carried: [] }],
  ])("falls back to a plain terminal on %s", (_, over) => {
    expect(terminalHarnessChoice({ ...base, ...over })).toEqual({
      kind: "fallback",
    });
  });

  // TEST_SCENARIO: a harness with a fitting granted provider is offered on it; a carried harness no provider the owner holds fits cannot start, so it is not offered.
  it("offers only the harnesses that can start", () => {
    expect(terminalHarnessChoice(base)).toEqual({
      kind: "harnesses",
      harnesses: [
        {
          name: "claude-code",
          displayName: "Claude",
          provider: "a",
          attachable: [],
        },
      ],
    });
  });

  // TEST_SCENARIO: providers the owner holds but this agent was not granted can be attached on the way, so the harness is offered with them to pick from instead of being left out.
  it("offers to attach a fitting provider the owner holds", () => {
    const choice = terminalHarnessChoice({
      ...base,
      owned: [anthropic, openai],
    });
    expect(choice.kind === "harnesses" && choice.harnesses[1]).toEqual({
      name: "codex",
      displayName: "Codex",
      provider: null,
      attachable: [openai],
    });
  });

  // TEST_SCENARIO: an agent holds one connection of a kind at a time, so a second connection of a kind it already holds is left out rather than offered and then refused.
  it("leaves out a provider of a kind the agent already holds", () => {
    const key = { ...anthropic, templateId: "anthropic" };
    const oauth = {
      id: "oa",
      name: "Anthropic",
      type: "anthropic" as const,
      templateId: "anthropic-oauth",
    };
    expect(attachableProviders([key], [oauth])).toEqual([]);
    expect(attachableProviders([], [oauth])).toEqual([oauth]);
  });
});
