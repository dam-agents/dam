import type { TurnSummary } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  matchTurnsToReplies,
  type ReplyLike,
} from "../../modules/telemetry/lib/align-turns.js";

/**
 * TEST_OVERVIEW: which reply a turn's telemetry belongs under. The harness's
 * own name for the prompt is the join when both sides carry it; the prompt's
 * time is the fallback for replies that never learned that name.
 */

const turn = (
  startedAt: string,
  over: Partial<TurnSummary> = {},
): TurnSummary => ({
  turnId: startedAt,
  promptId: null,
  groupedBy: "time",
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

const keyedTurn = (promptId: string, startedAt: string): TurnSummary =>
  turn(startedAt, { turnId: promptId, promptId, groupedBy: "prompt-id" });

const prompt = (at?: string): ReplyLike => ({
  id: `u-${at ?? "none"}`,
  role: "user",
  streaming: false,
  ...(at === undefined ? {} : { at }),
});

const reply = (id: string, over: Partial<ReplyLike> = {}): ReplyLike => ({
  id,
  role: "assistant",
  streaming: false,
  ...over,
});

describe("matchTurnsToReplies by the harness prompt id", () => {
  it("puts a turn under the reply that carries its prompt id", () => {
    /**
     * TEST_SCENARIO: the clocks disagree wildly — the turn started long before
     * the prompt was stamped — and the key still wins.
     */
    const turns = [keyedTurn("p1", "2026-09-16T09:00:00.000Z")];
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      reply("r1", { telemetryPromptId: "p1" }),
    ];

    expect(matchTurnsToReplies(turns, messages).get("r1")?.turnId).toBe("p1");
  });

  it("holds a keyed reply's turn back while the reply still streams", () => {
    const turns = [keyedTurn("p1", "2026-09-16T12:00:01.000Z")];
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      reply("r1", { telemetryPromptId: "p1", streaming: true }),
    ];

    expect(matchTurnsToReplies(turns, messages).size).toBe(0);
  });

  it("does not lend a keyed reply an unkeyed turn by time", () => {
    /**
     * TEST_SCENARIO: the reply knows its prompt id but that turn's records have
     * not landed yet; guessing from the clock would show and then swap.
     */
    const turns = [turn("2026-09-16T12:00:01.000Z")];
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      reply("r1", { telemetryPromptId: "p-missing" }),
    ];

    expect(matchTurnsToReplies(turns, messages).size).toBe(0);
  });

  it("never lets a timed match displace a keyed one", () => {
    const turns = [
      keyedTurn("p1", "2026-09-16T12:00:01.000Z"),
      turn("2026-09-16T12:00:30.000Z"),
    ];
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      reply("r1", { telemetryPromptId: "p1" }),
    ];

    expect(matchTurnsToReplies(turns, messages).get("r1")?.turnId).toBe("p1");
  });

  it("matches keyed and unkeyed exchanges side by side", () => {
    const turns = [
      turn("2026-09-16T12:00:01.000Z"),
      keyedTurn("p2", "2026-09-16T12:05:01.000Z"),
    ];
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      reply("r1"),
      prompt("2026-09-16T12:05:00.000Z"),
      reply("r2", { telemetryPromptId: "p2" }),
    ];

    const matched = matchTurnsToReplies(turns, messages);

    expect(matched.get("r1")?.turnId).toBe("2026-09-16T12:00:01.000Z");
    expect(matched.get("r2")?.turnId).toBe("p2");
  });
});

describe("matchTurnsToReplies by time, for replies without a prompt id", () => {
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
     * TEST_SCENARIO: a turn whose reply is still streaming was attaching to
     * the reply before it, then jumping forward when the reply finished.
     */
    const turns = [
      turn("2026-09-16T12:00:01.000Z"),
      turn("2026-09-16T12:05:01.000Z"),
    ];
    const messages = [
      prompt("2026-09-16T12:00:00.000Z"),
      reply("r1"),
      prompt("2026-09-16T12:05:00.000Z"),
      reply("r2", { streaming: true }),
    ];

    const matched = matchTurnsToReplies(turns, messages);

    expect(matched.get("r1")?.turnId).toBe("2026-09-16T12:00:01.000Z");
    expect(matched.has("r2")).toBe(false);
  });

  it("tolerates a prompt stamp running slightly ahead of the harness", () => {
    /**
     * TEST_SCENARIO: the sender's own bubble keeps the browser's stamp, so a
     * small lead must not push the turn onto the wrong prompt.
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
      reply("n1", { notice: true }),
      reply("r1"),
    ];

    const matched = matchTurnsToReplies(turns, messages);

    expect(matched.has("n1")).toBe(false);
    expect(matched.get("r1")).toBeDefined();
  });

  it("leaves a reply with neither a prompt id nor a prompt time unlabelled", () => {
    /**
     * TEST_SCENARIO: lining such replies up by position shifted every reply
     * onto the next one's telemetry; showing nothing is the honest answer.
     */
    const turns = [
      turn("2026-09-16T12:00:00.000Z"),
      turn("2026-09-16T12:05:00.000Z"),
    ];
    const messages = [prompt(), reply("r1"), prompt(), reply("r2")];

    expect(matchTurnsToReplies(turns, messages).size).toBe(0);
  });

  it("matches nothing when there are no turns", () => {
    expect(
      matchTurnsToReplies([], [prompt("2026-09-16T12:00:00.000Z"), reply("r1")])
        .size,
    ).toBe(0);
  });

  it("is stable when a later turn arrives", () => {
    /**
     * TEST_SCENARIO: polling must not move an already-placed turn, which is
     * what produced the jumping between adjacent replies.
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
