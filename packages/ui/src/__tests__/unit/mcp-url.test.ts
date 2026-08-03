import { describe, expect, test } from "vitest";

import { validateMcpUrl } from "../../modules/connections/lib/mcp-url.js";

describe("validateMcpUrl", () => {
  test.each([
    "https://mcp.example.com/sse",
    "http://localhost:8080/mcp",
    "https://mcp.example.com",
  ])("accepts %s", (url) => {
    expect(validateMcpUrl(url)).toBeNull();
  });

  test.each([
    ["not-a-url", /valid URL/],
    ["", /valid URL/],
    ["mcp.example.com", /valid URL/],
    ["ftp://mcp.example.com", /http or https/],
    ["javascript:alert(1)", /http or https/],
  ] as const)("rejects %s", (url, pattern) => {
    expect(validateMcpUrl(url)).toMatch(pattern);
  });
});
