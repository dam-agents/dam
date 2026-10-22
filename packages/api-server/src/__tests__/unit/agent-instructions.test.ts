import { describe, it, expect } from "vitest";
import { seedsAgentInstructions } from "../../modules/agents/domain/agent-instructions.js";

describe("seedsAgentInstructions", () => {
  it("seeds the template for an agent created without a kit", () => {
    expect(seedsAgentInstructions({ name: "calm-harbor" })).toBe(true);
  });

  // TEST_SCENARIO: a kit or a home seed brings its own definition into the home, so the platform template would only stand in its way.
  it("skips an agent whose home a kit or a home seed defines", () => {
    expect(
      seedsAgentInstructions({
        name: "calm-harbor",
        starterKit: "curated/code-guardian@1.0.0",
      }),
    ).toBe(false);
    expect(
      seedsAgentInstructions({
        name: "calm-harbor",
        gitRepo: { url: "https://github.com/o/r", into: "home" },
      }),
    ).toBe(false);
  });

  // TEST_SCENARIO: an Environment runs no harness, so a template in its home would have no reader.
  it("skips an Environment", () => {
    expect(
      seedsAgentInstructions({ name: "calm-harbor", environmentOf: "agent-1" }),
    ).toBe(false);
  });
});
