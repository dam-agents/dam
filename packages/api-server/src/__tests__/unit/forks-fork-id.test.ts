import { describe, it, expect } from "vitest";
import { forkIdFor } from "../../modules/forks/infrastructure/fork-id.js";

describe("forkIdFor", () => {
  it("is deterministic — same (agent, replier) always maps to the same fork", () => {
    expect(forkIdFor("agent-1", "kc|user-42")).toBe(
      forkIdFor("agent-1", "kc|user-42"),
    );
  });

  it("separates agents and repliers", () => {
    const base = forkIdFor("agent-1", "kc|user-42");
    expect(forkIdFor("agent-2", "kc|user-42")).not.toBe(base);
    expect(forkIdFor("agent-1", "kc|user-43")).not.toBe(base);
  });

  it("produces DNS-1035-safe names with headroom for derived suffixes", () => {
    const id = forkIdFor("agent-" + "x".repeat(200), "kc|" + "y".repeat(200));
    expect(id).toMatch(/^fork-[0-9a-f]{16}$/);
    expect(`${id}-gateway`.length).toBeLessThanOrEqual(63);
  });
});
