import type { TurnSummary } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  matchTurnsToReplies,
  type ReplyLike,
  turnIndexForReply,
} from "../../modules/telemetry/lib/align-turns.js";

/**
 * TEST_OVERVIEW: which reply a turn's telemetry belongs under. The prompt is the
 * anchor — a user message carries a time from the moment it is sent, while a
 * reply only gains one once the session is reloaded.
 */

const turn = (
  startedAt: string,
  over: Partial<TurnSummary> = {},
): TurnSummary => ({
  turnId: startedAt,
  startedAt,
  endedAt: startedAt,
  durationMs: 0,
  prompted: true,
  rootName: "",
  spanCount: 0,
  recordCount: 1,
  errorCount: 0,
  traceIds: [],
  models: [],
  calls: 1,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  ...over,
});

const prompt = (at?: string): ReplyLike => ({
  id: `u-${at ?? "none"}`,
  role: "user",
  streaming: false,
  ...(at === undefined ? {} : { at }),
});

const reply = (id: string, streaming = false): ReplyLike => ({
  id,
  role: "assistant",
  streaming,
});

describe("matchTurnsToReplies", () => {
  it("puts a turn under the reply to the prompt it followed", () => {
    const turns = [
      turn("2026-09-16T12:00:01.000Z"),
      turn("2026-09-16T12:05:01.000Z"),
    ];
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      reply("r1"),
      prompt("2026-09-16T12:05:00.000Z"),
      reply("r2"),
    ];

    const matched = matchTurnsToReplies(turns, messages);

    expect(matched.get("r1")?.turnId).toBe("2026-09-16T12:00:01.000Z");
    expect(matched.get("r2")?.turnId).toBe("2026-09-16T12:05:01.000Z");
  });

  it("does not park an in-flight turn on the previous reply", () => {
    /**
     * TEST_SCENARIO: the bug this exists for — a turn whose reply is still
     * streaming was attaching to the reply before it, then jumping forward when
     * the reply finished. It waits instead.
     */
    const turns = [
      turn("2026-09-16T12:00:01.000Z"),
      turn("2026-09-16T12:05:01.000Z"),
    ];
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      reply("r1"),
      prompt("2026-09-16T12:05:00.000Z"),
      reply("r2", true),
    ];

    const matched = matchTurnsToReplies(turns, messages);

    expect(matched.get("r1")?.turnId).toBe("2026-09-16T12:00:01.000Z");
    expect(matched.has("r2")).toBe(false);
  });

  it("attaches the turn as soon as its reply stops streaming", () => {
    const turns = [turn("2026-09-16T12:05:01.000Z")];
    const settled = [prompt("2026-09-16T12:05:00.000Z"), reply("r2")];

    expect(matchTurnsToReplies(turns, settled).get("r2")?.turnId).toBe(
      "2026-09-16T12:05:01.000Z",
    );
  });

  it("tolerates a prompt clock running slightly ahead of the harness", () => {
    /**
     * TEST_SCENARIO: the browser stamps the prompt and the harness stamps the
     * telemetry, so a small skew must not push the turn onto the wrong prompt.
     */
    const turns = [turn("2026-09-16T12:00:00.000Z")];
    const messages = [prompt("2026-09-16T12:00:02.000Z"), reply("r1")];

    expect(matchTurnsToReplies(turns, messages).get("r1")).toBeDefined();
  });

  it("ignores a turn that precedes every prompt", () => {
    const turns = [turn("2026-09-16T11:00:00.000Z")];
    const messages = [prompt("2026-09-16T12:00:00.000Z"), reply("r1")];

    expect(matchTurnsToReplies(turns, messages).size).toBe(0);
  });

  it("keeps the later turn when two follow the same prompt", () => {
    const turns = [
      turn("2026-09-16T12:00:01.000Z"),
      turn("2026-09-16T12:00:09.000Z"),
    ];
    const messages = [prompt("2026-09-16T12:00:00.000Z"), reply("r1")];

    expect(matchTurnsToReplies(turns, messages).get("r1")?.turnId).toBe(
      "2026-09-16T12:00:09.000Z",
    );
  });

  it("ignores notices, which are not replies", () => {
    const turns = [turn("2026-09-16T12:00:01.000Z")];
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      { id: "n1", role: "assistant", streaming: false, notice: true },
      reply("r1"),
    ];

    const matched = matchTurnsToReplies(turns, messages);

    expect(matched.has("n1")).toBe(false);
    expect(matched.get("r1")).toBeDefined();
  });

  it("falls back to position when no prompt carries a time", () => {
    const turns = [
      turn("2026-09-16T12:00:00.000Z"),
      turn("2026-09-16T12:05:00.000Z"),
    ];
    const messages = [
      prompt(),
      reply("r1"),
      prompt(),
      reply("r2"),
      prompt(),
      reply("r3"),
    ];

    const matched = matchTurnsToReplies(turns, messages);

    expect(matched.has("r1")).toBe(false);
    expect(matched.get("r2")?.turnId).toBe("2026-09-16T12:00:00.000Z");
    expect(matched.get("r3")?.turnId).toBe("2026-09-16T12:05:00.000Z");
  });

  it("matches nothing when there are no turns", () => {
    expect(
      matchTurnsToReplies([], [prompt("2026-09-16T12:00:00.000Z"), reply("r1")])
        .size,
    ).toBe(0);
  });

  it("is stable when a later turn arrives", () => {
    /**
     * TEST_SCENARIO: polling must not move an already-placed turn, which is what
     * produced the jumping between adjacent replies.
     */
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      reply("r1"),
      prompt("2026-09-16T12:05:00.000Z"),
      reply("r2"),
    ];
    const first = matchTurnsToReplies(
      [turn("2026-09-16T12:00:01.000Z")],
      messages,
    );
    const second = matchTurnsToReplies(
      [turn("2026-09-16T12:00:01.000Z"), turn("2026-09-16T12:05:01.000Z")],
      messages,
    );

    expect(first.get("r1")?.turnId).toBe(second.get("r1")?.turnId);
  });
});

describe("turnIndexForReply", () => {
  const alignAll = (turnCount: number, replyCount: number) =>
    Array.from({ length: replyCount }, (_, i) =>
      turnIndexForReply(turnCount, replyCount, i),
    );

  it("maps one-to-one when the counts agree", () => {
    expect(alignAll(3, 3)).toEqual([0, 1, 2]);
  });

  it("keeps the newest reply correct when a turn is missing", () => {
    expect(alignAll(4, 5)).toEqual([null, 0, 1, 2, 3]);
  });

  it("refuses an index outside the reply range", () => {
    expect(turnIndexForReply(3, 3, -1)).toBeNull();
    expect(turnIndexForReply(3, 3, 3)).toBeNull();
  });
});
