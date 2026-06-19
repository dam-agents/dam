import { describe, it, expect, vi } from "vitest";
import { printServiceError } from "../modules/shared/trpc/print.js";

const HOST = "http://api-server.localhost:4444";

function captureStderr(): { lines: () => string; restore: () => void } {
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return {
    lines: () => spy.mock.calls.map((c) => String(c[0])).join(""),
    restore: () => spy.mockRestore(),
  };
}

describe("printServiceError auth-required hint", () => {
  it("points at `dam auth login` when DAM_TOKEN is not set", () => {
    const out = captureStderr();
    printServiceError(
      { kind: "auth-required", reason: "session expired for host" },
      HOST,
      {},
    );
    const text = out.lines();
    out.restore();

    expect(text).toContain(
      "error: not authenticated: session expired for host",
    );
    expect(text).toContain("run `dam auth login` first");
    expect(text).not.toContain("DAM_TOKEN");
  });

  it("points at the rejected token, not login, when DAM_TOKEN is set", () => {
    const out = captureStderr();
    printServiceError(
      { kind: "auth-required", reason: "session expired" },
      HOST,
      {
        DAM_TOKEN: "pk_whatever",
      },
    );
    const text = out.lines();
    out.restore();

    expect(text).toContain("DAM_TOKEN was rejected");
    expect(text).not.toContain("dam auth login");
  });
});
