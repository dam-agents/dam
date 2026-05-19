import { describe, it, expect } from "vitest";
import {
  rewriteAuthError,
  rewriteCwd,
} from "../../modules/acp/infrastructure/mappers.js";

describe("rewriteAuthError", () => {
  it("prepends hint when error.message contains authentication_error", () => {
    const input = JSON.stringify({
      id: 1,
      error: { message: "authentication_error: bad key" },
    });
    const out = JSON.parse(rewriteAuthError(input));
    expect(out.error.message).toMatch(/Authentication Error:/);
    expect(out.error.message).toMatch(/authentication_error: bad key/);
  });

  it("prepends hint on sessionUpdate text content", () => {
    const input = JSON.stringify({
      method: "session/update",
      params: {
        update: {
          content: { type: "text", text: "authentication_error occurred" },
        },
      },
    });
    const out = JSON.parse(rewriteAuthError(input));
    expect(out.params.update.content.text).toMatch(/Authentication Error:/);
    expect(out.params.update.content.text).toMatch(
      /authentication_error occurred/,
    );
  });

  it("leaves unrelated frames untouched", () => {
    const input = JSON.stringify({ id: 1, result: { ok: true } });
    expect(rewriteAuthError(input)).toBe(input);
  });

  it("passes non-JSON through unchanged", () => {
    expect(rewriteAuthError("not json")).toBe("not json");
  });
});

describe("rewriteCwd", () => {
  it("replaces params.cwd with the pod working dir", () => {
    const out = rewriteCwd(
      { params: { cwd: ".", mcpServers: [] } },
      "/pod/work",
    );
    expect(out.params.cwd).toBe("/pod/work");
    expect(out.params.mcpServers).toEqual([]);
  });

  it("leaves frames without params.cwd untouched", () => {
    const frame = { params: { sessionId: "s" } };
    expect(rewriteCwd(frame, "/pod/work")).toEqual(frame);
  });

  it("leaves frames with no params untouched", () => {
    const frame = { id: 1, method: "x" };
    expect(rewriteCwd(frame, "/pod/work")).toEqual(frame);
  });
});
