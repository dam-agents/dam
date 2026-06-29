import { describe, it, expect } from "vitest";
import { buildTrialPrompt } from "../../modules/experiments/domain/trial-prompt.js";

describe("buildTrialPrompt", () => {
  it("leads with the goal and always appends the autonomy directive", () => {
    const prompt = buildTrialPrompt({
      prompt: "  Evolve X to minimize Y  ",
      armSpec: {},
    });
    expect(prompt.startsWith("Evolve X to minimize Y")).toBe(true);
    expect(prompt).toMatch(/autonomous experiment arm/i);
    expect(prompt).toMatch(/never pause to ask/i);
    expect(prompt).toMatch(/record_run/);
  });

  it("includes the arm configuration when present, before the directive", () => {
    const prompt = buildTrialPrompt({
      prompt: "Goal",
      armSpec: { temperature: 0.7 },
    });
    expect(prompt).toContain('"temperature": 0.7');
    // The autonomy directive is the last block so it reads as the operating rule.
    expect(prompt.indexOf("Your arm configuration")).toBeLessThan(
      prompt.indexOf("autonomous experiment arm"),
    );
  });

  it("omits the arm configuration block when armSpec is empty", () => {
    const prompt = buildTrialPrompt({ prompt: "Goal", armSpec: {} });
    expect(prompt).not.toContain("Your arm configuration");
  });
});
