import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubRestClient } from "../../modules/skills/infrastructure/github-rest-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGitHubRestClient — transport failures", () => {
  it("returns UpstreamUnreachable when fetch throws (JSON endpoint)", async () => {
    const cause = new Error("Connect Timeout Error");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause })),
    );
    const res = await createGitHubRestClient().getCommitHead({
      owner: "acme",
      repo: "private",
    });
    expect(res).toEqual({
      ok: false,
      error: {
        kind: "UpstreamUnreachable",
        method: "GET",
        path: "/repos/acme/private/commits/HEAD",
        detail: "fetch failed: Connect Timeout Error",
      },
    });
  });

  it("returns UpstreamUnreachable when fetch throws (bytes endpoint)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const res = await createGitHubRestClient().fetchTarball(
      { owner: "acme", repo: "private" },
      "abc123",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("UpstreamUnreachable");
      expect(res.error).toMatchObject({ detail: "fetch failed" });
    }
  });
});
