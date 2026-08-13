import { describe, expect, test } from "vitest";

import { isExternalHttpUrl } from "../../lib/external-link.js";

describe("isExternalHttpUrl", () => {
  test("accepts http and https", () => {
    expect(isExternalHttpUrl("https://code.claude.com/whats-new")).toBe(true);
    expect(isExternalHttpUrl("http://example.test/notes")).toBe(true);
  });

  test("rejects a scheme that executes", () => {
    expect(isExternalHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalHttpUrl("data:text/html;base64,PHA+")).toBe(false);
  });

  test("rejects a value with no scheme, which would resolve same-origin", () => {
    expect(isExternalHttpUrl("example.com/notes")).toBe(false);
    expect(isExternalHttpUrl("/admin")).toBe(false);
    expect(isExternalHttpUrl("")).toBe(false);
  });
});
