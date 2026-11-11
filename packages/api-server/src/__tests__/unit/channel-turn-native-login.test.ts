// TEST_OVERVIEW: A channel cannot authorize an agent's native subscription itself; the safe startup failure tells the owner where to sign in, including when JSON-RPC wraps its details.
import { describe, expect, it } from "vitest";
import { classifyTurnFailure } from "../../modules/channels/infrastructure/turn-failure-copy.js";

describe("channel native ChatGPT login", () => {
  it.each([
    new Error(
      "the harness exited (ChatGPT sign-in is required on this agent.)",
    ),
    {
      message: "Internal error",
      data: {
        details:
          "the harness exited (ChatGPT sign-in is required on this agent.)",
      },
    },
  ])("asks the owner to sign in on this agent", (err) => {
    const failure = classifyTurnFailure(err);
    expect(failure.reason).toBe("chatgpt-login-required");
    expect(failure.kind).toBe("plain");
    if (failure.kind !== "plain")
      throw new Error("expected owner instructions");
    const copy = failure.copy({
      uiBaseUrl: "https://platform.example",
      agentId: "agent-1",
      threads: true,
    });
    expect(copy).toContain("ChatGPT sign-in");
    expect(copy).toContain("owner");
    expect(copy).toContain("Sign in to ChatGPT");
    expect(copy).toContain(
      "https://platform.example/sandboxes/agent-1/providers",
    );
  });

  it("leaves an unrelated harness exit generic", () => {
    expect(
      classifyTurnFailure(new Error("the harness exited (exit code 1)")).reason,
    ).toBe("acp-error");
  });
});
