import { describe, expect, test } from "vitest";

import { stripFences } from "../../modules/sessions/components/tool-chip.js";

describe("stripFences", () => {
  test("strips triple backtick code fences with language tag", () => {
    expect(stripFences("```bash\necho hello\n```")).toBe("echo hello");
    expect(stripFences('```json\n{\n  "ok": true\n}\n```')).toBe(
      '{\n  "ok": true\n}',
    );
  });

  test("strips bare triple backticks without language tag", () => {
    expect(stripFences("```\nsome output\n```")).toBe("some output");
  });

  test("preserves plain text without fences", () => {
    expect(stripFences("plain output without fences")).toBe(
      "plain output without fences",
    );
  });

  test("handles empty string", () => {
    expect(stripFences("")).toBe("");
  });

  test("handles fences with leading or trailing whitespace", () => {
    expect(stripFences("```ts\nconst x = 1;\n```   ")).toBe("const x = 1;");
  });
});
