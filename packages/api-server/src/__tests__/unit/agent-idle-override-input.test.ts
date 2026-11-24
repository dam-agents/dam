// TEST_OVERVIEW: a regular Agent has no idle window of its own: the create and update a client sends ignore an idle override, so an older client asking for "never sleeps" gets an Agent that sleeps on the install's idle timeout instead of an error.
import { describe, expect, it } from "vitest";
import { agentCreateInputSchema, agentUpdateInputSchema } from "api-server-api";

describe("the agents API idle override", () => {
  it("drops it from a create", () => {
    const parsed = agentCreateInputSchema.parse({
      name: "my-agent",
      templateId: "claude-code",
      hibernationTimeoutMin: 0,
    });
    expect(parsed).not.toHaveProperty("hibernationTimeoutMin");
  });

  it("drops it from an update", () => {
    const parsed = agentUpdateInputSchema.parse({
      id: "agent-0123456789abcdef",
      hibernationTimeoutMin: 60,
    });
    expect(parsed).toEqual({ id: "agent-0123456789abcdef" });
  });
});
