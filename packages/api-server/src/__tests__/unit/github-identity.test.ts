// TEST_OVERVIEW: A label the platform did not write, such as a GitHub account or repository name from a custom endpoint, can reach a terminal. ESC starts a C0 escape sequence, but so does U+009B, the C1 CSI: a UTF-8 terminal decodes it to the same control and runs the sequence. The filter drops every control up to U+009F and keeps printable text, so neither can spoof the output.
import { describe, expect, it } from "vitest";
import { stripControlChars } from "../../modules/connections/infrastructure/github-identity.js";

describe("stripControlChars", () => {
  it("drops C0, DEL and C1 controls and keeps printable text", () => {
    expect(stripControlChars("dam\u001b[31m-bot\u0007")).toBe("dam[31m-bot");
    expect(stripControlChars("a\u007fb")).toBe("ab");
    expect(stripControlChars("x\u009b2J\u009bHy")).toBe("x2JHy");
    expect(stripControlChars("žluťoučký kůň")).toBe("žluťoučký kůň");
  });
});
