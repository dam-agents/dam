// TEST_OVERVIEW: a Slack or Telegram turn the harness refused because of the session's model — gone, invalid, or its key refused — gets a reply that names the model and links the agent's Providers page, never the generic "try again", which would fail the same way every time.
import { MODEL_REFUSED_BY_HARNESS_REASON } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import { classifyTurnFailure } from "../../modules/channels/infrastructure/turn-failure-copy.js";
import { softLimitText } from "../../modules/spend/domain/refusal.js";

const ctx = {
  uiBaseUrl: "https://dam.example",
  agentId: "agent-1",
  threads: true,
};

const refusal = (message: string, reason?: string) =>
  Object.assign(
    new Error(message),
    reason === undefined ? {} : { data: { platform: { reason } } },
  );

function copyOf(err: unknown): { reason: string; copy: string } {
  const failure = classifyTurnFailure(err);
  if (failure.kind !== "plain") throw new Error(`not plain: ${failure.kind}`);
  return { reason: failure.reason, copy: failure.copy(ctx) };
}

describe("channel turn refused for the session's model", () => {
  // TEST_SCENARIO: the runtime names the refusal in the error's data; the reply quotes the harness's reason, says a retry won't help and links the Providers page, and the log reason is its own.
  it("names the refusal the runtime marks in its data", () => {
    const { reason, copy } = copyOf(
      refusal(
        "The harness refused the session's model: Model 'claude/ibm/aws/claude-opus-5-5' not found",
        MODEL_REFUSED_BY_HARNESS_REASON,
      ),
    );
    expect(reason).toBe("model-refused-by-harness");
    expect(copy).toContain(
      "“Model 'claude/ibm/aws/claude-opus-5-5' not found”",
    );
    expect(copy).toContain("Trying again won't help");
    expect(copy).toContain("https://dam.example/sandboxes/agent-1/providers");
    expect(copy).not.toContain("The harness refused the session's model");
  });

  // TEST_SCENARIO: the data reason alone marks the refusal, whatever its message says, so the text can change without the reply falling back to "try again".
  it("knows the refusal by its data alone", () => {
    expect(
      copyOf(refusal("Invalid params", MODEL_REFUSED_BY_HARNESS_REASON)),
    ).toMatchObject({
      reason: "model-refused-by-harness",
      copy: expect.stringContaining("“Invalid params”"),
    });
  });

  // TEST_SCENARIO: a runtime older than the data reason sends only its message; the refusal is still known by it, as the provider's refused key is.
  it("knows an older runtime's refusal by its message", () => {
    const { reason, copy } = copyOf(
      refusal(
        "The harness refused the session's model: Authentication failed. Please check your API credentials.",
      ),
    );
    expect(reason).toBe("model-refused-by-harness");
    expect(copy).toContain(
      "“Authentication failed. Please check your API credentials.”",
    );
  });

  // TEST_SCENARIO: the harness's text reaches Slack inside the reply, so angle brackets in it cannot form a Slack mention or link.
  it("keeps the harness's text from forming Slack markup", () => {
    const { copy } = copyOf(
      refusal(
        "The harness refused the session's model: Invalid value <!channel>",
        MODEL_REFUSED_BY_HARNESS_REASON,
      ),
    );
    expect(copy).toContain("“Invalid value ‹!channel›”");
  });

  // TEST_SCENARIO: a spend limit the gate reports while the harness sets the model stays a spend stop, as before.
  it("leaves a spend stop a spend stop", () => {
    expect(
      classifyTurnFailure(
        refusal(
          `The harness refused the session's model: API error: 429 ${softLimitText("DAM")} · model not changed`,
          MODEL_REFUSED_BY_HARNESS_REASON,
        ),
      ).kind,
    ).toBe("spend");
  });

  // TEST_SCENARIO: an error that is not this refusal still gets the generic reply.
  it("leaves other errors to the generic reply", () => {
    expect(copyOf(new Error("Internal error")).reason).toBe("acp-error");
  });
});
