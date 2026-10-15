// TEST_OVERVIEW: what a new web terminal offers. While the agent's harnesses, the harness catalog or the provider grants load, nothing shows, so no harness reads unavailable by mistake. A failed load or an agent naming no harness falls back to one plain terminal. Otherwise every carried harness is listed with the first granted provider that fits it, else the providers the owner holds that the agent could take, leaving out one of a kind it already holds, else a reason that names the harness.
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

  // TEST_SCENARIO: a harness with a fitting granted provider opens on it; one with no fitting provider at all says why, by name.
  it("lists each harness with its provider or the reason it cannot start", () => {
    expect(terminalHarnessChoice(base)).toEqual({
      kind: "harnesses",
      harnesses: [
        {
          name: "claude-code",
          displayName: "Claude",
          provider: "a",
          attachable: [],
          unavailable: null,
        },
        {
          name: "codex",
          displayName: "Codex",
          provider: null,
          attachable: [],
          unavailable:
            "Codex does not support any of the LLM providers you have configured.",
        },
      ],
    });
  });

  // TEST_SCENARIO: providers the owner holds but this agent was not granted can be attached on the way, so the harness is offered with them to pick from instead of reading unavailable.
  it("offers to attach a fitting provider the owner holds", () => {
    const choice = terminalHarnessChoice({
      ...base,
      owned: [anthropic, openai],
    });
    expect(choice.kind === "harnesses" && choice.harnesses[1]).toMatchObject({
      provider: null,
      attachable: [openai],
      unavailable: null,
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
