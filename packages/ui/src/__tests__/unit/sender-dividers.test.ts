// TEST_OVERVIEW: in a session more than one person sent prompts to, the chat marks who sent each run of messages with a divider: the email of someone else, or "You". A session only the viewer wrote to shows none. Only people are Senders: a message the platform made has no divider and does not change who sent last. A Sender is matched to a message by its prompt id, or by time once the log was rebuilt from the harness's history and the ids changed.
import type { PlatformSenderEntry } from "api-server-api";
import { describe, expect, it } from "vitest";

import { senderNames } from "../../modules/sessions/lib/sender-names.js";
import {
  dividerLabel,
  threadItems,
  userRunsOf,
} from "../../modules/sessions/lib/thread-items.js";
import type { Message } from "../../types.js";

const OWNER = { sub: "owner-sub", email: "owner@example.com" };
const EDITOR = { sub: "editor-sub", email: "editor@example.com" };

function user(id: string, at: string, notice = false): Message {
  return {
    id,
    role: "user",
    parts: [{ kind: "text", text: id }],
    streaming: false,
    at,
    ...(notice && { notice: true }),
  };
}

function reply(id: string, at: string): Message {
  return {
    id,
    role: "assistant",
    parts: [{ kind: "text", text: "ok" }],
    streaming: false,
    at,
  };
}

const entry = (
  promptId: string,
  at: string,
  sender: typeof OWNER,
): PlatformSenderEntry => ({ promptId, at, sender });

function labelsFor(
  messages: Message[],
  entries: PlatformSenderEntry[],
  viewer: string,
): string[] {
  const names = senderNames(viewer, {
    role: "owner",
    editors: [],
    permissions: [],
  });
  return threadItems(messages, [], { entries, viewerSub: viewer }).flatMap(
    (item) =>
      item.kind === "divider"
        ? [dividerLabel(item, new Date("2026-10-24T12:00:00Z"), names.nameOf)]
        : [],
  );
}

const T = (minute: number) =>
  `2026-10-24T10:${String(minute).padStart(2, "0")}:00Z`;

describe("sender dividers", () => {
  // TEST_SCENARIO: AC-1, the owner reads an editor's message after their own; the editor's email sits above it and "You" above the owner's next one.
  it("marks every change of Sender", () => {
    const messages = [
      user("p1", T(1)),
      reply("r1", T(2)),
      user("p2", T(3)),
      reply("r2", T(4)),
      user("p3", T(5)),
    ];
    const entries = [
      entry("p1", T(1), OWNER),
      entry("p2", T(3), EDITOR),
      entry("p3", T(5), OWNER),
    ];
    expect(labelsFor(messages, entries, OWNER.sub)).toEqual([
      "editor@example.com",
      "You",
    ]);
  });

  // TEST_SCENARIO: AC-2, a session only the viewer sent prompts to looks as it does today.
  it("shows nothing in a session only the viewer wrote to", () => {
    const messages = [user("p1", T(1)), reply("r1", T(2)), user("p2", T(3))];
    const entries = [entry("p1", T(1), OWNER), entry("p2", T(3), OWNER)];
    expect(labelsFor(messages, entries, OWNER.sub)).toEqual([]);
  });

  // TEST_SCENARIO: AC-3, a session an editor started opens with the editor's email above its first message when the owner reads it.
  it("names the first Sender when it is not the viewer", () => {
    const messages = [user("p1", T(1)), reply("r1", T(2))];
    expect(labelsFor(messages, [entry("p1", T(1), EDITOR)], OWNER.sub)).toEqual(
      ["editor@example.com"],
    );
  });

  // TEST_SCENARIO: a scheduled fire between two of the owner's messages has no Sender, so it gets no divider and the owner's next message does not get "You" again.
  it("ignores messages the platform made", () => {
    const messages = [
      user("p1", T(1)),
      reply("r1", T(2)),
      user("fire", T(3), true),
      reply("r2", T(4)),
      user("p2", T(5)),
    ];
    const entries = [entry("p1", T(1), EDITOR), entry("p2", T(5), EDITOR)];
    expect(labelsFor(messages, entries, OWNER.sub)).toEqual([
      "editor@example.com",
    ]);
  });

  // TEST_SCENARIO: AC-7, after a restart the log comes from the harness's history with new message ids and slightly later times; each message still takes the Sender recorded nearest its time.
  it("matches by time when the ids changed", () => {
    const messages = [
      user("h1", "2026-10-24T10:01:02Z"),
      reply("r1", T(2)),
      user("h2", "2026-10-24T10:03:01Z"),
    ];
    const entries = [entry("p1", T(1), OWNER), entry("p2", T(3), EDITOR)];
    expect(labelsFor(messages, entries, OWNER.sub)).toEqual([
      "editor@example.com",
    ]);
  });

  // TEST_SCENARIO: messages the agent took as one batch but two people sent are drawn in two parts, with a divider where the Sender changes.
  it("splits a batch where the Sender changes", () => {
    const messages = [user("p1", T(1)), user("p2", T(1)), user("p3", T(1))];
    const entries = [
      entry("p1", T(1), OWNER),
      entry("p2", T(1), OWNER),
      entry("p3", T(1), EDITOR),
    ];
    const items = threadItems(messages, [], {
      entries,
      viewerSub: OWNER.sub,
    });
    const runs = userRunsOf(items);
    expect([...runs.runs.values()].map((run) => run.map((m) => m.id))).toEqual([
      ["p1", "p2"],
      ["p3"],
    ]);
  });

  // TEST_SCENARIO: a divider that falls on the same message as a day divider becomes one line naming the day and the Sender.
  it("joins a day divider and a sender divider", () => {
    const messages = [
      user("p1", "2026-10-23T10:00:00Z"),
      reply("r1", "2026-10-23T10:01:00Z"),
      user("p2", "2026-10-24T10:00:00Z"),
    ];
    const entries = [
      entry("p1", "2026-10-23T10:00:00Z", OWNER),
      entry("p2", "2026-10-24T10:00:00Z", EDITOR),
    ];
    const labels = labelsFor(messages, entries, OWNER.sub);
    expect(labels[labels.length - 1]).toBe("Today · editor@example.com");
  });
});
