import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubRestClient } from "../../modules/skills/infrastructure/github-rest-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGitHubRestClient", () => {
  it("returns UpstreamUnreachable with the cause chain when fetch throws", async () => {
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
});
