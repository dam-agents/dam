/**
 * TEST_OVERVIEW: The bot-post loop bound admits at most a fixed number of bot
 * posts per conversation since a person last posted there. A person's post
 * resets the count, and a count older than a day no longer applies.
 */
import { describe, expect, it } from "vitest";
import { createBotPostLoopBound } from "../../modules/channels/domain/bot-post-loop-bound.js";

describe("createBotPostLoopBound", () => {
  it("admits bot posts up to the limit", () => {
    const bound = createBotPostLoopBound({ limit: 2 });
    expect(bound.admitBotPost("c")).toBe(true);
    expect(bound.admitBotPost("c")).toBe(true);
    expect(bound.admitBotPost("c")).toBe(false);
  });

  it("resets when a person posts", () => {
    const bound = createBotPostLoopBound({ limit: 1 });
    expect(bound.admitBotPost("c")).toBe(true);
    expect(bound.admitBotPost("c")).toBe(false);
    bound.notePersonPost("c");
    expect(bound.admitBotPost("c")).toBe(true);
  });

  it("counts each conversation on its own", () => {
    const bound = createBotPostLoopBound({ limit: 1 });
    expect(bound.admitBotPost("c1")).toBe(true);
    expect(bound.admitBotPost("c2")).toBe(true);
  });

  /** TEST_SCENARIO: A conversation that has been quiet for a day starts a new
   *  count, so an old run of bot posts does not silence it forever. */
  it("forgets a count after a day", () => {
    let now = 0;
    const bound = createBotPostLoopBound({ limit: 1, now: () => now });
    expect(bound.admitBotPost("c")).toBe(true);
    expect(bound.admitBotPost("c")).toBe(false);
    now += 24 * 60 * 60 * 1000 + 1;
    expect(bound.admitBotPost("c")).toBe(true);
  });
});
