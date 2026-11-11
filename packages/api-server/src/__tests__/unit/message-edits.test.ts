/**
 * TEST_OVERVIEW: The record of the edits made to a Slack conversation's
 * messages. A Session reads the record when a turn is built for it. It is
 * owed the edits to messages it was already handed, and is listed each one
 * once: when the turn is delivered the read is settled, and a turn that fails
 * settles nothing. An edit to a message the Session has not been handed yet
 * is not listed, because the Session reads that message with its current
 * text; it is settled with the rest. The Agent that wrote the message is owed
 * nothing, an Agent's Sessions are told apart, a thread's edits and the
 * channel's are kept apart, and the record expires and is capped.
 */
import { describe, expect, it } from "vitest";
import {
  createMessageEdits,
  type EditReader,
  type MessageEdit,
} from "../../modules/channels/domain/message-edits.js";

const CHANNEL = "C1";

function edit(
  over: Partial<MessageEdit<string>> & { ts: string },
): MessageEdit<string> {
  return {
    threadTs: null,
    authorAgentId: null,
    message: `text of ${over.ts}`,
    ...over,
  };
}

const reader = (over: Partial<EditReader> = {}): EditReader => ({
  agentId: "agent-1",
  session: "session-1",
  threadTs: null,
  since: "120.000000",
  carried: [],
  ...over,
});

function owed(
  edits: ReturnType<typeof createMessageEdits<string>>,
  who: EditReader = reader(),
): string[] {
  return edits.readBy(CHANNEL, who).owed.map((e) => e.ts);
}

describe("createMessageEdits", () => {
  it("owes an edit to a session that was already handed the message", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000" }));

    expect(owed(edits)).toEqual(["100.000000"]);
  });

  /** TEST_SCENARIO: A message newer than everything the Session was handed
   *  is read from Slack with its current text when the Session catches up,
   *  so listing it as changed would show it twice. Once that turn is
   *  delivered the Session has the new text, so it is never listed later. */
  it("lists no edit to a message the session reads fresh, then or later", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "130.000000" }));

    const read = edits.readBy(CHANNEL, reader());
    expect(read.owed).toEqual([]);
    read.settle();

    expect(owed(edits, reader({ since: "200.000000" }))).toEqual([]);
  });

  /** TEST_SCENARIO: A Session opened after the edit reads the conversation's
   *  history as it is now. It has no boundary yet, is listed nothing, and
   *  holds the new text once its first turn is delivered. */
  it("owes nothing to a session that starts by reading the history", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000" }));

    const read = edits.readBy(CHANNEL, reader({ since: null }));
    expect(read.owed).toEqual([]);
    read.settle();

    expect(owed(edits)).toEqual([]);
  });

  it("owes nothing to the agent that wrote the message", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000", authorAgentId: "agent-1" }));

    expect(owed(edits)).toEqual([]);
    expect(
      owed(edits, reader({ agentId: "agent-2", session: "session-2" })),
    ).toEqual(["100.000000"]);
  });

  it("lists no edit to a message the turn itself carries", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000" }));

    expect(owed(edits, reader({ carried: ["100.000000"] }))).toEqual([]);
  });

  /** TEST_SCENARIO: A thread's reader is owed the edits of its replies and of
   *  the message that opened it; the reader of the channel outside threads is
   *  owed top-level messages only. */
  it("keeps a thread's edits and the channel's apart", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000" }));
    edits.note(CHANNEL, edit({ ts: "110.000000", threadTs: "100.000000" }));
    edits.note(CHANNEL, edit({ ts: "115.000000", threadTs: "90.000000" }));

    expect(owed(edits)).toEqual(["100.000000"]);
    expect(owed(edits, reader({ threadTs: "100.000000" }))).toEqual([
      "100.000000",
      "110.000000",
    ]);
  });

  /** TEST_SCENARIO: One Agent can hold a message in two Sessions, the
   *  channel's and a thread's. Telling one of them leaves the other owed. */
  it("lists an edit once to each session", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000" }));

    edits.readBy(CHANNEL, reader()).settle();

    expect(owed(edits)).toEqual([]);
    expect(owed(edits, reader({ session: "session-2" }))).toEqual([
      "100.000000",
    ]);
  });

  /** TEST_SCENARIO: A turn that fails never reached the Session, so the read
   *  made for it is not settled and the next turn lists the edit again. */
  it("keeps an edit owed when the read is not settled", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000" }));

    edits.readBy(CHANNEL, reader());

    expect(owed(edits)).toEqual(["100.000000"]);
  });

  /** TEST_SCENARIO: The newest message a Session holds can move far past the
   *  time of an edit without the Session being listed it, as when a message
   *  is steered into a running turn. The edit must stay owed. */
  it("keeps an edit owed however far the session has read since", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000" }));

    expect(owed(edits, reader({ since: "900.000000" }))).toEqual([
      "100.000000",
    ]);
  });

  /** TEST_SCENARIO: A Session told of an edit inside a turn already running
   *  must not be listed it again by its next turn. */
  it("owes nothing to a session told in a running turn", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000" }));

    edits.tell(CHANNEL, "100.000000", "session-1");

    expect(owed(edits)).toEqual([]);
  });

  /** TEST_SCENARIO: A second edit of one message replaces the first, and is
   *  owed again to a Session already listed the first. Settling the read
   *  that listed the first, after the second arrived, must not hide the
   *  second. */
  it("owes a later edit of the same message again", () => {
    const edits = createMessageEdits<string>();
    edits.note(CHANNEL, edit({ ts: "100.000000", message: "first" }));
    const first = edits.readBy(CHANNEL, reader());
    edits.note(CHANNEL, edit({ ts: "100.000000", message: "second" }));

    first.settle();

    expect(edits.readBy(CHANNEL, reader()).owed.map((e) => e.message)).toEqual([
      "second",
    ]);
  });

  it("forgets an edit after its time to live", () => {
    let now = 0;
    const edits = createMessageEdits<string>({ ttlMs: 10, now: () => now });
    edits.note(CHANNEL, edit({ ts: "100.000000" }));

    now = 11;

    expect(owed(edits)).toEqual([]);
  });

  it("keeps only the newest edits of a busy conversation", () => {
    const edits = createMessageEdits<string>({ maxPerChannel: 2 });
    edits.note(CHANNEL, edit({ ts: "100.000000" }));
    edits.note(CHANNEL, edit({ ts: "101.000000" }));
    edits.note(CHANNEL, edit({ ts: "102.000000" }));

    expect(owed(edits)).toEqual(["101.000000", "102.000000"]);
  });
});
