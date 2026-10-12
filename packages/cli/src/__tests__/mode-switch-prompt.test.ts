import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { askModeSwitch } from "../modules/chat/compose.js";

function sink(): PassThrough {
  return new PassThrough().resume();
}

describe("askModeSwitch", () => {
  // TEST_SCENARIO: Ctrl-D at the `[y/N]` prompt closes stdin without a line. The prompt must answer "no". A prompt that never answers let the event loop empty, and Node ended `dam chat` with "Detected unsettled top-level await".
  it("answers no when stdin closes before an answer", async () => {
    const input = new PassThrough();
    const answer = askModeSwitch(input, sink());
    input.end();
    expect(await answer).toBe(false);
  });

  it("answers yes to y even though the prompt closes stdin after it", async () => {
    const input = new PassThrough();
    const answer = askModeSwitch(input, sink());
    input.end("y\n");
    expect(await answer).toBe(true);
  });
});
