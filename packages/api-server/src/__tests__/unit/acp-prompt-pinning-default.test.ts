// TEST_OVERVIEW: a turn that continues a session from before the Model Router reaches a runtime that refuses it for having no model. The api-server answers that refusal alone by pinning the agent's saved default on the session and sending the turn once more, so a runtime that never refuses keeps every session's own model.
import { describe, expect, it, vi } from "vitest";
import type { SessionPair } from "api-server-api";

import { promptPinningDefault } from "../../core/acp-client.js";
import { NoDefaultModelError } from "../../modules/harness-config/domain/no-default-model.js";

const noModel = {
  code: -32001,
  message: "This session has no model.",
  data: { platform: { reason: "no-model" } },
};

const saved: SessionPair = {
  harness: "claude-code",
  provider: "conn-1",
  model: "ibm/aws/claude-sonnet-5-5",
};

function connection() {
  const request = vi.fn(async () => ({}));
  return {
    request,
    conn: { agent: { request } } as unknown as Parameters<
      typeof promptPinningDefault
    >[0],
  };
}

describe("promptPinningDefault", () => {
  // TEST_SCENARIO: the first prompt is refused as no-model, the saved default is pinned on that session, and the prompt is sent again.
  it("pins the saved default and sends the turn again", async () => {
    const { request, conn } = connection();
    const prompt = vi
      .fn()
      .mockRejectedValueOnce(noModel)
      .mockResolvedValueOnce({ stopReason: "end_turn" });
    await expect(
      promptPinningDefault(conn, "s-old", prompt, async () => saved),
    ).resolves.toEqual({ stopReason: "end_turn" });
    expect(request).toHaveBeenCalledWith("_platform/session/pin_model", {
      sessionId: "s-old",
      model: saved.model,
    });
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  // TEST_SCENARIO: any other failure is passed through untouched and nothing is pinned.
  it("pins nothing for another failure", async () => {
    const { request, conn } = connection();
    const failure = { code: -32603, message: "harness crashed" };
    await expect(
      promptPinningDefault(
        conn,
        "s-old",
        () => Promise.reject(failure),
        async () => saved,
      ),
    ).rejects.toBe(failure);
    expect(request).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: an agent with no default fails the turn as having none, which the channels turn into their "no default model" reply.
  it("fails as no default model when the agent has none", async () => {
    const { request, conn } = connection();
    await expect(
      promptPinningDefault(
        conn,
        "s-old",
        () => Promise.reject(noModel),
        async () => {
          throw new NoDefaultModelError();
        },
      ),
    ).rejects.toBeInstanceOf(NoDefaultModelError);
    expect(request).not.toHaveBeenCalled();
  });
});
