import { describe, expect, it } from "vitest";

import { modelGuidance } from "../../modules/sessions/components/model-indicator.js";

describe("modelGuidance", () => {
  it("says the model is fixed for the session when it cannot be switched", () => {
    const text = modelGuidance(false, undefined);
    expect(text).toContain("fixed for this session");
    expect(text).toContain("start a new session");
    expect(text).not.toContain("Agent Setup");
  });

  it("offers the switch list without a settings page", () => {
    expect(modelGuidance(true, undefined)).toBe(". Switch it below.");
  });

  it("points to a settings page that has a model setting", () => {
    expect(modelGuidance(false, "Agent Setup")).toBe(
      ". Change the model in Agent Setup.",
    );
    expect(modelGuidance(true, "Agent Setup")).toContain(
      "default for new sessions in Agent Setup",
    );
  });
});
