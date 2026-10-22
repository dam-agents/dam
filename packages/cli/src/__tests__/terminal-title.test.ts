import { describe, expect, it } from "vitest";

import {
  createTitleFilter,
  setTitle,
} from "../modules/chat/infrastructure/terminal-title.js";

const run = (chunks: string[]) => {
  const filter = createTitleFilter();
  return chunks.map((c) => filter(Buffer.from(c)).toString("utf8")).join("");
};

describe("createTitleFilter", () => {
  it("drops OSC 0 and OSC 2 titles and keeps the rest", () => {
    expect(
      run(["a\x1b]0;Claude\x07b\x1b]2;x\x1b\\c\x1b[2Jd\x1b]8;;u\x07e"]),
    ).toBe("abc\x1b[2Jd\x1b]8;;u\x07e");
  });

  // TEST_SCENARIO: the harness's title sequence arrives split across WebSocket frames. A filter that looks at one frame alone lets the second half through, and the harness's title replaces the leave hint.
  it("drops a title split across chunks", () => {
    expect(run(["a\x1b", "]", "0;Cla", "ude\x1b", "\\b"])).toBe("ab");
    expect(run(["a\x1b]2", ";t\x07b"])).toBe("ab");
  });

  it("passes an escape that only looks like a title start", () => {
    expect(run(["a\x1b", "[1mb"])).toBe("a\x1b[1mb");
    expect(run(["a\x1b]", "1;icon\x07b"])).toBe("a\x1b]1;icon\x07b");
  });

  it("ends a dropped title at a bare escape", () => {
    expect(run(["\x1b]0;t\x1b[1mb"])).toBe("\x1b[1mb");
  });
});

describe("setTitle", () => {
  it("strips control characters that would end the sequence", () => {
    expect(setTitle("a\x07b\x1bc")).toBe("\x1b]2;abc\x07");
  });
});
