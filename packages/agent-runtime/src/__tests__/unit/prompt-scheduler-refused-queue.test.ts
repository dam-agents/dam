import { describe, expect, it, vi } from "vitest";

import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";
import {
  createPromptScheduler,
  type PromptSubmission,
} from "../../modules/acp/services/acp-runtime/prompt-scheduler.js";

// TEST_OVERVIEW: a queue the harness refused must answer its senders and write its prompts down, so text a person typed comes back after the session it started in is gone.

function channel(sent: string[]): ClientChannel {
  return {
    isOpen: () => true,
    send: (line: string) => sent.push(line),
  } as unknown as ClientChannel;
}

function submission(
  sessionId: string,
  outboundId: number,
  sent: string[],
): PromptSubmission {
  return {
    sessionId,
    channel: channel(sent),
    outboundId,
    originalId: outboundId,
    frame: { params: { prompt: [{ type: "text", text: "go" }] } },
    promptId: `p${String(outboundId)}`,
  };
}

describe("a refused queue", () => {
  /**
   * TEST_SCENARIO: The harness refuses the session's model and every prompt
   * waiting behind it is dropped. Each sender is answered with the reason, and
   * each prompt is announced as dropped so the runtime writes it down: without
   * that, the text is gone for good once the session it was typed in is removed
   * (QA: connecting a provider from the picker, then sending at once, lost the
   * message).
   */
  it("answers its senders and records what it dropped", () => {
    const sent: string[] = [];
    const onQueueDropped = vi.fn();
    const scheduler = createPromptScheduler({
      canStart: () => true,
      sendToAgent: () => false,
      onQueueDropped,
    });

    scheduler.submit(submission("s1", 7, sent));
    scheduler.refuseQueue("s1", "the harness refused the session's model");

    expect(onQueueDropped).toHaveBeenCalledTimes(1);
    const [sessionId, dropped, cause] = onQueueDropped.mock.calls[0]!;
    expect(sessionId).toBe("s1");
    expect(dropped.map((entry: PromptSubmission) => entry.promptId)).toEqual([
      "p7",
    ]);
    expect(cause).toBe("harness-refused");
    expect(sent.map((line) => JSON.parse(line))).toContainEqual({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32000,
        message: "the harness refused the session's model",
      },
    });
  });
});
