import { describe, expect, it } from "vitest";
import {
  rewriteCutOf,
  withOriginalTimes,
} from "../../modules/acp/domain/rewrite-cut.js";

/**
 * TEST_OVERVIEW: Where a rewind or fork cuts the harness's own history, and
 * how the copy keeps the original's times.
 *
 * The history is the session-history provider's replay: one `session/update`
 * frame per line, each stamped with the harness entry it came from
 * (`platform.entry`) and the time it was written (`platform.at`). A rewrite
 * keeps everything above the message being rewritten, so the cut is the entry
 * right before that message — whatever it is. The runtime's own log names a
 * message sent live by the sender's prompt id; that id is matched to the
 * history by text. The copy's last entry carries the time of the fork, which
 * must give way to the original's.
 */

const SESSION = "s1";

function frame(
  update: Record<string, unknown>,
  platform: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: SESSION, update, _meta: { platform } },
  });
}

function user(id: string, text: string, at = "2026-10-08T07:00:00Z"): string {
  return frame(
    {
      sessionUpdate: "user_message_chunk",
      messageId: id,
      content: { type: "text", text },
    },
    { entry: id, at },
  );
}

function agent(id: string, text: string, at = "2026-10-08T07:01:00Z"): string {
  return frame(
    {
      sessionUpdate: "agent_message_chunk",
      messageId: id,
      content: { type: "text", text },
    },
    { entry: id, at },
  );
}

function toolCall(entry: string, toolCallId: string): string {
  return frame(
    { sessionUpdate: "tool_call", toolCallId, title: "sleep 30" },
    { entry, at: "2026-10-08T07:00:30Z" },
  );
}

function toolResult(entry: string, toolCallId: string): string {
  return frame(
    { sessionUpdate: "tool_call_update", toolCallId, status: "completed" },
    { entry, at: "2026-10-08T07:00:40Z" },
  );
}

function echo(promptId: string, text: string): string {
  return frame({
    sessionUpdate: "user_message_chunk",
    messageId: promptId,
    content: { type: "text", text },
  });
}

function timesOf(lines: string[]): unknown[] {
  return lines.map(
    (line) =>
      (JSON.parse(line) as { params: { _meta: { platform: { at?: string } } } })
        .params._meta.platform.at,
  );
}

const steeredHistory = [
  user("u1", "My name is Petr, wait 30 seconds."),
  toolCall("msg_a", "t1"),
  toolResult("tr1", "t1"),
  user("u2", "I changed my mind"),
  agent("msg_b", "Have a bad day, Petr!"),
];

describe("rewriteCutOf", () => {
  /**
   * TEST_SCENARIO: A message steered into a running turn lands in the harness
   * history right after the tool call the agent was running, with no reply
   * between it and the first message. Rewinding to it must keep the first
   * message and the tool call, so the cut is the tool result — never an empty
   * session, which lost the first message.
   */
  it("should cut a steered message right after the entry above it", () => {
    expect(rewriteCutOf(steeredHistory, [], "u2")).toEqual({
      kind: "after",
      entry: "tr1",
    });
  });

  /**
   * TEST_SCENARIO: A message the client sent live is named by its prompt id,
   * which the harness history does not know. The runtime's log echoed it with
   * that id and its text, so the history entry with the same text is the one
   * to cut before.
   */
  it("should find a live message through the log's echo of it", () => {
    const log = [
      echo("p1", "My name is Petr, wait 30 seconds."),
      toolCall("msg_a", "t1"),
      toolResult("tr1", "t1"),
      echo("p2", "I changed my mind"),
    ];

    expect(rewriteCutOf(steeredHistory, log, "p2")).toEqual({
      kind: "after",
      entry: "tr1",
    });
  });

  /**
   * TEST_SCENARIO: Only the first message of a conversation has nothing above
   * it; rewinding to it starts a new, empty session.
   */
  it("should start fresh only for the first message", () => {
    expect(rewriteCutOf(steeredHistory, [], "u1")).toEqual({ kind: "start" });
  });

  /**
   * TEST_SCENARIO: When the same text was sent twice, the echo's place among
   * the messages with that text — counted from the newest — picks the entry,
   * so an older history the log no longer holds cannot shift the match.
   */
  it("should tell repeated messages apart by their place from the newest", () => {
    const history = [
      user("u1", "again"),
      agent("msg_a", "one"),
      user("u2", "again"),
      agent("msg_b", "two"),
    ];
    const log = [echo("p2", "again"), agent("msg_b", "two")];

    expect(rewriteCutOf(history, log, "p2")).toEqual({
      kind: "after",
      entry: "msg_a",
    });
  });

  /**
   * TEST_SCENARIO: A message the history does not hold cannot be cut before;
   * the rewrite must be refused rather than cut somewhere else.
   */
  it("should report a message the history does not hold", () => {
    expect(rewriteCutOf(steeredHistory, [], "unknown")).toEqual({
      kind: "missing",
    });
  });

  /**
   * TEST_SCENARIO: A provider from an older image stamps no entries; the cut
   * cannot be resolved here, so the caller falls back to the client's own.
   */
  it("should give no answer for a history without entry stamps", () => {
    const unstamped = [
      frame({
        sessionUpdate: "user_message_chunk",
        messageId: "u1",
        content: { type: "text", text: "hi" },
      }),
    ];

    expect(rewriteCutOf(unstamped, [], "u1")).toBeNull();
  });
});

describe("withOriginalTimes", () => {
  /**
   * TEST_SCENARIO: The harness writes the copy's last entry with the time of
   * the fork. The copy must show it at the time it was first written, like
   * every other copied entry — but only while the copy and the original line
   * up: from the first difference on, nothing takes a time from the original.
   */
  it("should give the copy the original's times while they line up", () => {
    const original = [
      user("u1", "My name is Ann.", "2026-10-08T07:25:11Z"),
      agent("msg_a", "OK", "2026-10-08T07:25:13Z"),
      user("u2", "What is my fav color?", "2026-10-08T07:26:00Z"),
    ];
    const copy = [
      user("c1", "My name is Ann.", "2026-10-08T07:25:11Z"),
      agent("msg_a", "OK", "2026-10-12T10:13:31Z"),
      user("c2", "something else", "2026-10-12T10:13:40Z"),
    ];

    expect(timesOf(withOriginalTimes(copy, original))).toEqual([
      "2026-10-08T07:25:11Z",
      "2026-10-08T07:25:13Z",
      "2026-10-12T10:13:40Z",
    ]);
  });
});

describe("rewriteCutOf: a batch", () => {
  /**
   * TEST_SCENARIO: Messages sent while the agent worked reached it as one
   * batch — one harness entry carrying each of them. The runtime's log echoed
   * them one by one. Rewinding the batch, named by its first message, must
   * cut right before the whole batch, after the tool result above it.
   */
  it("cuts before the whole batch", () => {
    const history = [
      user("u1", "Hi, wait 20 seconds."),
      toolCall("msg_a", "t1"),
      toolResult("tr1", "t1"),
      user("u2", "be grumpy"),
      user("u2", "be funny"),
      agent("msg_b", "sigh"),
    ];
    const log = [
      echo("p1", "Hi, wait 20 seconds."),
      toolCall("msg_a", "t1"),
      toolResult("tr1", "t1"),
      echo("p2", "be grumpy"),
      echo("p3", "be funny"),
    ];

    expect(rewriteCutOf(history, log, "p2")).toEqual({
      kind: "after",
      entry: "tr1",
    });
    expect(rewriteCutOf(history, [], "u2")).toEqual({
      kind: "after",
      entry: "tr1",
    });
  });
});
