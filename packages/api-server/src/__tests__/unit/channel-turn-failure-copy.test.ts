import { describe, expect, it } from "vitest";
import { NO_MODEL_REASON } from "agent-runtime-api";
import { classifyTurnFailure } from "../../modules/channels/infrastructure/turn-failure-copy.js";

// TEST_OVERVIEW: The reply a channel turn gets when it fails, chosen from the error that ended it.
describe("classifyTurnFailure", () => {
  // TEST_SCENARIO: the runtime refuses a turn for lack of a model only when no provider serves it, so the reply names the missing provider and links the Providers section instead of a generic relay failure.
  it("answers a runtime no-model refusal with the no-provider reply", () => {
    const failure = classifyTurnFailure(
      Object.assign(new Error("no model"), {
        data: { platform: { reason: NO_MODEL_REASON } },
      }),
    );
    expect(failure.reason).toBe("no-default-model");
    const copy = failure.copy({
      uiBaseUrl: "https://dam.example",
      agentId: "agent-1",
      threads: true,
    });
    expect(copy).toContain("no model provider");
    expect(copy).toContain("https://dam.example/sandboxes/agent-1/providers");
  });
});
