import { describe, expect, it } from "vitest";
import { createWorld, promptTextsOf } from "./acp-world.js";

/**
 * TEST_OVERVIEW: a follow-up chat of a finished sub-agent. The Session starts
 * from the sub-agent's prompt and result, and the harness gets that copy once:
 * in front of the first prompt, never again.
 */

const SESSION = "sess-follow-up";

const continuedFrom = {
  invocationId: "inv-1",
  label: "count vowels",
  prompt: "Count the vowels in banana.",
  result: "banana has 3 vowels.",
};

function prompt(id: number, text: string): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId: SESSION,
      prompt: [{ type: "text", text }],
      _meta: { platform: { promptId: `p-${id}`, surface: "ui" } },
    },
  };
}

describe("acp-runtime: follow-up chats", () => {
  /**
   * TEST_SCENARIO: The first prompt of a follow-up chat carries the copy, so
   * the agent knows what the sub-agent did. A second prompt must not carry it
   * again, or every turn would repeat the whole result.
   */
  it("frames the copy into the first prompt only", () => {
    const world = createWorld();
    const client = world.connect();
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: { cwd: ".", _meta: { platform: { continuedFrom } } },
    });
    world.harness().replyTo("session/new", { sessionId: SESSION });

    client.send(prompt(2, "why 3?"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    client.send(prompt(3, "and in apple?"));

    const [first, second] = promptTextsOf(world.harness());
    expect(first).toContain("<continued-from");
    expect(first).toContain("banana has 3 vowels.");
    expect(first?.endsWith("why 3?")).toBe(true);
    expect(second).toBe("and in apple?");
  });
});
