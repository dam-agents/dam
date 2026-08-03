import { describe, it, expect } from "vitest";
import { backgroundWorkReportSchema } from "agent-runtime-api";
import { createBackgroundWorkRegistry } from "../../modules/acp/services/background-work-registry.js";

/** What the route does: parse the body, then report what parsed. */
function reportThrough(sessionId: string, body: unknown) {
  const registry = createBackgroundWorkRegistry();
  const parsed = backgroundWorkReportSchema.safeParse(body);
  if (parsed.success) registry.report(sessionId, parsed.data.items);
  return { accepted: parsed.success, registry };
}

describe("the background-work report contract", () => {
  it("holds despite an over-long command, clamping instead of rejecting", () => {
    // Regression: `command` used to be length-capped, so one long command line —
    // which a real job easily has — failed the whole report. The route 400d, the
    // reporter's fetch resolved (4xx is not an error), and the hold was lost
    // silently: #2965 again, over the length of a cosmetic field.
    const command = `python train.py ${"--flag x ".repeat(200)}`;
    expect(command.length).toBeGreaterThan(500);

    const { accepted, registry } = reportThrough("s1", {
      items: [{ id: "t1", command }],
    });

    expect(accepted).toBe(true);
    expect(registry.hasWork("s1")).toBe(true);
    expect(registry.held()[0]!.items[0]!.command).toHaveLength(500);
  });

  it("clamps an over-long description too", () => {
    const { accepted, registry } = reportThrough("s1", {
      items: [{ id: "t1", description: "x".repeat(5_000) }],
    });

    expect(accepted).toBe(true);
    expect(registry.held()[0]!.items[0]!.description).toHaveLength(200);
  });

  it("still holds when a reporter sends more items than the contract keeps", () => {
    // The hold is per session, so one surviving item is enough; rejecting the
    // list would hold nothing.
    const items = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}` }));

    const { accepted, registry } = reportThrough("s1", { items });

    expect(accepted).toBe(true);
    expect(registry.hasWork("s1")).toBe(true);
    expect(registry.held()[0]!.items).toHaveLength(64);
  });

  it("accepts the empty report that releases a hold", () => {
    const parsed = backgroundWorkReportSchema.safeParse({ items: [] });

    expect(parsed.success).toBe(true);
  });

  it("rejects a structurally malformed item, which no length can cause", () => {
    // The line is deliberate: length is data-dependent and would fail sporadically
    // in production, so it is always clamped. A missing id is a reporter bug that
    // fails on its first attempt, where a loud 400 is the useful answer.
    expect(
      backgroundWorkReportSchema.safeParse({
        items: [{ description: "no id" }],
      }).success,
    ).toBe(false);
    expect(
      backgroundWorkReportSchema.safeParse({ items: "nope" }).success,
    ).toBe(false);
  });
});
