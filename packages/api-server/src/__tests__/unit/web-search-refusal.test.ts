// TEST_OVERVIEW: the answer to a refused web search. On the Messages endpoint it is a successful reply whose search failed as unavailable, in the shape the call asked for, so the agent reads a failed search and carries on with another tool; anywhere else it is a plain refusal by the gateway. Both carry the platform's refusal header and say why, and how the owner changes it.
import { describe, expect, it } from "vitest";
import { PLATFORM_REFUSAL_HEADER } from "api-server-api";
import { refusedWebSearch } from "../../modules/approvals/domain/web-search-refusal.js";

function events(
  body: string,
): { event: string; data: Record<string, unknown> }[] {
  return body
    .trim()
    .split("\n\n")
    .map((frame) => {
      const [eventLine, dataLine] = frame.split("\n");
      return {
        event: eventLine!.replace("event: ", ""),
        data: JSON.parse(dataLine!.replace("data: ", "")) as Record<
          string,
          unknown
        >,
      };
    });
}

describe("a refused web search", () => {
  // TEST_SCENARIO: a call that does not stream gets one message: the search it asked for, its failed result, and a text that says the gateway refused it.
  it("answers a JSON call with a failed search", () => {
    const refusal = refusedWebSearch({
      endpoint: "messages",
      stream: false,
      model: "claude-sonnet-4-5",
      query: "dam news",
      reason: "denied",
    });
    expect(refusal.status).toBe(200);
    expect(refusal.headers[PLATFORM_REFUSAL_HEADER]).toBe("web-search");
    const message = JSON.parse(refusal.body) as {
      model: string;
      stop_reason: string;
      content: {
        type: string;
        input?: unknown;
        content?: unknown;
        text?: string;
      }[];
    };
    expect(message.model).toBe("claude-sonnet-4-5");
    expect(message.stop_reason).toBe("end_turn");
    expect(message.content.map((block) => block.type)).toEqual([
      "server_tool_use",
      "web_search_tool_result",
      "text",
    ]);
    expect(message.content[0]!.input).toEqual({ query: "dam news" });
    expect(message.content[1]!.content).toEqual({
      type: "web_search_tool_result_error",
      error_code: "unavailable",
    });
    expect(message.content[2]!.text).toContain("egress gateway");
    expect(message.content[2]!.text).toContain("Network settings");
  });

  // TEST_SCENARIO: a streaming call gets the same message as the Messages API streams one, each block opened and closed and the stream ended, so a streaming client reads it as it reads a real reply.
  it("answers a streaming call with the same failed search as events", () => {
    const refusal = refusedWebSearch({
      endpoint: "messages",
      stream: true,
      model: "m",
      query: null,
      reason: "unattended",
    });
    expect(refusal.headers["content-type"]).toBe("text/event-stream");
    const stream = events(refusal.body);
    expect(stream.map((e) => e.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    for (const e of stream) expect(e.data.type).toBe(e.event);
    const text = stream[7]!.data.delta as { text: string };
    expect(text.text).toContain("Always allow");
  });

  // TEST_SCENARIO: a batch or any endpoint other than the one that creates a message cannot take a message as its answer, so it gets a 403 that names the gateway.
  it("refuses any other endpoint plainly", () => {
    const refusal = refusedWebSearch({
      endpoint: "other",
      stream: false,
      model: "m",
      query: null,
      reason: "rule",
    });
    expect(refusal.status).toBe(403);
    expect(refusal.body).toContain("egress gateway");
  });
});
