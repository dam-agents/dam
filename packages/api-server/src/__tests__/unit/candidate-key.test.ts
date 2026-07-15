import { describe, expect, it } from "vitest";

import {
  armCandidateKey,
  isArmCandidateKey,
} from "../../modules/experiments/domain/candidate-key.js";

describe("armCandidateKey", () => {
  it("scopes the key to the arm and keeps only the basename", () => {
    const key = armCandidateKey("exp-1", "agent-1", "../../etc/passwd");
    expect(key.startsWith("exp-1/agent-1/")).toBe(true);
    expect(key.endsWith("/passwd")).toBe(true);
    expect(key).not.toContain("..");
  });

  it("falls back to 'candidate' for missing or empty basenames", () => {
    expect(armCandidateKey("e", "a", undefined).endsWith("/candidate")).toBe(
      true,
    );
    expect(armCandidateKey("e", "a", "/").endsWith("/candidate")).toBe(true);
  });
});

describe("isArmCandidateKey", () => {
  it("accepts only refs minted for this arm", () => {
    expect(isArmCandidateKey("exp-1/agent-1/u/c.bin", "exp-1", "agent-1")).toBe(
      true,
    );
    // Another arm of the same experiment.
    expect(isArmCandidateKey("exp-1/agent-2/u/c.bin", "exp-1", "agent-1")).toBe(
      false,
    );
    // Another experiment on the same agent.
    expect(isArmCandidateKey("exp-2/agent-1/u/c.bin", "exp-1", "agent-1")).toBe(
      false,
    );
    // Prefix-shaped but not boundary-aligned.
    expect(
      isArmCandidateKey("exp-1/agent-10/u/c.bin", "exp-1", "agent-1"),
    ).toBe(false);
    expect(isArmCandidateKey("arbitrary/key", "exp-1", "agent-1")).toBe(false);
  });
});
