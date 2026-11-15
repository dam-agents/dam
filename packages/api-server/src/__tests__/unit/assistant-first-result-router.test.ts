// TEST_OVERVIEW: the assistant reports its first result over the Connection that
// TEST_OVERVIEW: lets it act as the person: the procedure takes the write scope an
// TEST_OVERVIEW: Agent's key carries and an unrestricted key, because the record it
// TEST_OVERVIEW: writes is the person's rather than one Agent's — a key bound to some
// TEST_OVERVIEW: agents is refused, and the reference it carries is trimmed, may not
// TEST_OVERVIEW: smuggle control characters into a page, and is dropped when blank.
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { describe, expect, it, vi } from "vitest";

function setup(
  opts: { scopes?: string[]; agentIds?: readonly string[] | "*" } = {},
) {
  const recordFirstResult = vi.fn(async (input: unknown) => input);
  const ctx = {
    assistants: { recordFirstResult },
    terms: { isAccepted: async () => true },
    user: {
      sub: "user-1",
      preferredUsername: "u",
      scopes: opts.scopes ?? ["agents:operate"],
      agentIds: opts.agentIds ?? "*",
    },
  } as unknown as ApiContext;
  return { caller: appRouter.createCaller(ctx), recordFirstResult };
}

describe("the assistant's first-result report", () => {
  // TEST_SCENARIO: the assistant's own key — the Connection's, with the agents scope and no binding — records a result.
  it("accepts the Connection's own key", async () => {
    const w = setup();
    await w.caller.assistants.recordFirstResult({
      kind: "schedule",
      ref: "agent-dammy/weekly",
    });
    expect(w.recordFirstResult).toHaveBeenCalledWith({
      kind: "schedule",
      ref: "agent-dammy/weekly",
    });
  });

  // TEST_SCENARIO: a key bound to some agents cannot write the person's onboarding: it is refused before the record is touched.
  it("refuses a key bound to some agents", async () => {
    const w = setup({ agentIds: ["agent-1"] });
    await expect(
      w.caller.assistants.recordFirstResult({ kind: "schedule" }),
    ).rejects.toThrow(/unrestricted|wildcard/i);
    expect(w.recordFirstResult).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a key without the write scope is refused as well.
  it("refuses a read-only key", async () => {
    const w = setup({ scopes: ["agents:read"] });
    await expect(
      w.caller.assistants.recordFirstResult({ kind: "artifact" }),
    ).rejects.toThrow();
    expect(w.recordFirstResult).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the reference is trimmed, a blank one is no reference, one carrying a control character is refused, and a long one is capped.
  it("cleans the reference it carries", async () => {
    const w = setup();
    await w.caller.assistants.recordFirstResult({
      kind: "artifact",
      ref: "  Weekly status  ",
    });
    expect(w.recordFirstResult).toHaveBeenLastCalledWith({
      kind: "artifact",
      ref: "Weekly status",
    });

    await w.caller.assistants.recordFirstResult({
      kind: "artifact",
      ref: "   ",
    });
    expect(w.recordFirstResult).toHaveBeenLastCalledWith({ kind: "artifact" });

    await expect(
      w.caller.assistants.recordFirstResult({
        kind: "artifact",
        ref: "a\u001b[31mred\u001b[0m",
      }),
    ).rejects.toThrow();
    await expect(
      w.caller.assistants.recordFirstResult({
        kind: "artifact",
        ref: "x".repeat(501),
      }),
    ).rejects.toThrow();
  });
});
