import { describe, it, expect } from "vitest";
import { isDefunct, toForeignSub } from "../../modules/forks/domain/fork.js";

describe("toForeignSub", () => {
  it("rejects empty strings", () => {
    expect(() => toForeignSub("")).toThrow();
  });
});

describe("isDefunct", () => {
  it("flags Failed and legacy Completed as unusable slots", () => {
    expect(isDefunct({ phase: "Failed" })).toBe(true);
    expect(isDefunct({ phase: "Completed" })).toBe(true);
  });

  it("treats live and parked phases as reusable", () => {
    expect(isDefunct({ phase: "Pending" })).toBe(false);
    expect(isDefunct({ phase: "Ready", podIP: "10.0.0.5" })).toBe(false);
    expect(isDefunct({ phase: "Hibernated" })).toBe(false);
  });

  it("treats a status the controller has not written yet as reusable", () => {
    expect(isDefunct(null)).toBe(false);
  });
});
