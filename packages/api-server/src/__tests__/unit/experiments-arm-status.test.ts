import { describe, it, expect } from "vitest";
import {
  allArmsTerminal,
  isArmTerminal,
} from "../../modules/experiments/domain/arm-status.js";

describe("isArmTerminal", () => {
  it("treats completed/failed/stopped as terminal, pending/running as not", () => {
    expect(isArmTerminal("completed")).toBe(true);
    expect(isArmTerminal("failed")).toBe(true);
    expect(isArmTerminal("stopped")).toBe(true);
    expect(isArmTerminal("pending")).toBe(false);
    expect(isArmTerminal("running")).toBe(false);
  });
});

describe("allArmsTerminal", () => {
  it("is true only when every arm is terminal, regardless of the mix", () => {
    expect(allArmsTerminal(["completed", "failed", "stopped"])).toBe(true);
    expect(allArmsTerminal(["completed"])).toBe(true);
  });

  it("is false if any arm is still pending or running", () => {
    expect(allArmsTerminal(["completed", "running"])).toBe(false);
    expect(allArmsTerminal(["completed", "pending"])).toBe(false);
  });

  it("is false for an experiment with no arms (nothing ever ran)", () => {
    expect(allArmsTerminal([])).toBe(false);
  });
});
