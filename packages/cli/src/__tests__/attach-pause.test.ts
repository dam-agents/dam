import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { pauseBeforeAttach } from "../modules/chat/compose.js";

function sink(): PassThrough {
  return new PassThrough().resume();
}

describe("pauseBeforeAttach", () => {
  it("settles on Enter", async () => {
    const input = new PassThrough();
    const paused = pauseBeforeAttach(input, sink(), 60_000);
    input.write("\n");
    expect(await paused).toBe(true);
  });

  it("settles on its own when nobody presses Enter", async () => {
    expect(await pauseBeforeAttach(new PassThrough(), sink(), 10)).toBe(true);
  });

  // TEST_SCENARIO: stdin closes during the pause. The pause must settle so `dam chat` goes on, rather than let the event loop empty and end with "Detected unsettled top-level await".
  it("settles when stdin closes", async () => {
    const input = new PassThrough();
    const paused = pauseBeforeAttach(input, sink(), 60_000);
    input.end();
    expect(await paused).toBe(true);
  });

  // TEST_SCENARIO: the user presses Ctrl+C at the pause. Nothing is attached yet, so Ctrl+C is still the CLI's: `dam chat` must not connect once the wait runs out.
  it("cancels on Ctrl+C", async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(sink(), { isTTY: true });
    const paused = pauseBeforeAttach(input, output, 60_000);
    input.write("\x03");
    expect(await paused).toBe(false);
  });
});
