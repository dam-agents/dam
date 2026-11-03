// TEST_OVERVIEW: A label the platform did not write, such as a GitHub account or repository name from a custom endpoint, can reach a terminal. ESC starts a C0 escape sequence, but so does U+009B, the C1 CSI: a UTF-8 terminal decodes it to the same control and runs the sequence. The filter drops every control up to U+009F and keeps printable text, so neither can spoof the output. Such a label can also have any length, so `displayLabel` caps it at 200 characters, counted in code points: a cap counted in UTF-16 code units could cut a character outside the BMP in half, and PostgreSQL `jsonb` refuses to store the lone surrogate that leaves.
import { describe, expect, it } from "vitest";
import {
  displayLabel,
  stripControlChars,
} from "../../modules/connections/infrastructure/github-identity.js";

describe("stripControlChars", () => {
  it("drops C0, DEL and C1 controls and keeps printable text", () => {
    expect(stripControlChars("dam\u001b[31m-bot\u0007")).toBe("dam[31m-bot");
    expect(stripControlChars("a\u007fb")).toBe("ab");
    expect(stripControlChars("x\u009b2J\u009bHy")).toBe("x2JHy");
    expect(stripControlChars("žluťoučký kůň")).toBe("žluťoučký kůň");
  });
});

describe("displayLabel", () => {
  it("strips controls and caps at 200 characters", () => {
    expect(displayLabel(`\u001b[31m${"n".repeat(5000)}`)).toBe(
      `[31m${"n".repeat(196)}`,
    );
  });

  // TEST_SCENARIO: a hostile label puts an emoji, which is two UTF-16 code units, across code-unit positions 199 and 200, where a cap counted in code units would keep the high surrogate and drop the low one, so the stored label would hold a lone surrogate that PostgreSQL jsonb rejects.
  it("keeps a character outside the BMP whole at the boundary", () => {
    const label = displayLabel(`${"a".repeat(199)}😀${"b".repeat(100)}`);
    expect(label).toBe(`${"a".repeat(199)}😀`);
    expect([...label]).toHaveLength(200);
  });
});
