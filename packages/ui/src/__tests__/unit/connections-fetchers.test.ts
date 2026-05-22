import { beforeEach, describe, expect, it, vi } from "vitest";

import { authFetch } from "../../auth.js";
import { startMcpOAuth } from "../../modules/connections/api/fetchers.js";

vi.mock("../../auth.js", () => ({
  authFetch: vi.fn(),
}));

const mockedAuthFetch = vi.mocked(authFetch);

describe("connection fetchers", () => {
  beforeEach(() => {
    mockedAuthFetch.mockReset();
  });

  describe("startMcpOAuth", () => {
    it("surfaces backend MCP OAuth validation errors", async () => {
      mockedAuthFetch.mockResolvedValue(
        Response.json(
          { error: "MCP server does not support OAuth discovery" },
          { status: 400 },
        ),
      );

      await expect(startMcpOAuth("https://example.com/mcp")).rejects.toThrow(
        "MCP server does not support OAuth discovery",
      );
    });

    it("falls back to the status code when the error body is not JSON", async () => {
      mockedAuthFetch.mockResolvedValue(
        new Response("not json", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        }),
      );

      await expect(startMcpOAuth("https://example.com/mcp")).rejects.toThrow(
        "OAuth start failed (502)",
      );
    });
  });
});
