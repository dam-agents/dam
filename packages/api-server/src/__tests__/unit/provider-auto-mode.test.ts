/**
 * TEST_OVERVIEW: Which provider presets answer Claude Code's auto-mode check
 * themselves. Anthropic (both templates) and the IBM proxy do, so a Claude
 * session there needs no classifier of its own; every other preset does not,
 * so the router moves the classifier call to the session's provider.
 */
import { describe, expect, it } from "vitest";
import { type ProviderAlias, hasServerAutoMode } from "api-server-api";

describe("server-side auto mode", () => {
  /** TEST_SCENARIO: Both Anthropic templates share the `anthropic` alias and the IBM proxy is `ibm`; CurveBender, OpenAI, Bob, Bedrock and the platform preset answer no check of their own. */
  it("is Anthropic and the IBM proxy, and no other preset", () => {
    for (const alias of ["anthropic", "ibm"] as ProviderAlias[])
      expect(hasServerAutoMode(alias)).toBe(true);
    for (const alias of [
      "cb",
      "openai",
      "bob",
      "bedrock",
      "platform",
    ] as ProviderAlias[])
      expect(hasServerAutoMode(alias)).toBe(false);
  });
});
