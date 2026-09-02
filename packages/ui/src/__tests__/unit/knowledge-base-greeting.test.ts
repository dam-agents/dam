// TEST_OVERVIEW: the knowledge-base greeting is one install-time command every KB
// TEST_OVERVIEW: bootstrap provides, but harnesses expose installed commands under
// TEST_OVERVIEW: different names — the greeting must be issued in the form the chosen
// TEST_OVERVIEW: harness expands, and it must not arm until that harness is known,
// TEST_OVERVIEW: because the greeting latches once per agent.
import { describe, expect, test } from "vitest";

import { onboardCommandFor } from "../../modules/knowledge-bases/lib/onboard-command.js";
import { resolveAgentHarness } from "../../modules/knowledge-bases/lib/resolve-agent-harness.js";
import type { TemplateView } from "../../types.js";

const codex: TemplateView = {
  id: "codex",
  name: "Codex",
  image: "quay.io/x/codex",
  category: "harness",
  experimental: false,
  vm: false,
  harness: "codex",
};

describe("onboardCommandFor", () => {
  test("codex exposes installed prompts under its prompts prefix", () => {
    expect(onboardCommandFor("codex")).toBe("/prompts:wiki-onboard");
  });

  test("every other harness, and an unknown one, gets the plain command", () => {
    for (const h of ["claude-code", "pi", "bob", undefined] as const) {
      expect(onboardCommandFor(h)).toBe("/wiki-onboard");
    }
  });
});

describe("resolveAgentHarness", () => {
  test("is not ready until the templates query has succeeded — a failed fetch also leaves no data", () => {
    expect(resolveAgentHarness("codex", { data: undefined })).toEqual({
      ready: false,
    });
  });

  test("resolves the family once templates arrive", () => {
    expect(resolveAgentHarness("codex", { data: [codex] })).toEqual({
      ready: true,
      harness: "codex",
    });
  });

  test("a settled query without the template, or an agent with no template, is ready with no family", () => {
    expect(resolveAgentHarness("retired", { data: [codex] })).toEqual({
      ready: true,
      harness: undefined,
    });
    expect(resolveAgentHarness(null, { data: undefined })).toEqual({
      ready: true,
      harness: undefined,
    });
  });
});
