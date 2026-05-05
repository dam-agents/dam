import { describe, expect, it } from "vitest";
import { mergeYAMLFillIfMissing } from "../../modules/pod-files/merge.js";

describe("mergeYAMLFillIfMissing", () => {
  it("merges fill-if-missing: preserves existing values, fills missing fields, leaves unrelated keys alone", () => {
    // Existing file: one platform-managed host with a stale value, one host
    // baked by the agent image that the platform has nothing to say about. This
    // single fixture exercises every fill-if-missing invariant at once.
    const existing =
      "ghe.example.com:\n    user: previous-user\n" +
      "internal-ci.example.com:\n    user: ci-bot\n    git_protocol: ssh\n";

    const { merged, changed } = mergeYAMLFillIfMissing(existing, [
      { "ghe.example.com": { user: "new-user", oauth_token: "dummy-placeholder" } },
    ]);
    expect(changed).toBe(true);

    // Existing value of a present field: NEVER overwrite.
    expect(merged).toContain("user: previous-user");
    expect(merged).not.toContain("user: new-user");
    // Missing field on the same key: filled.
    expect(merged).toContain("oauth_token: dummy-placeholder");
    // Unrelated key the producer didn't mention: preserved verbatim
    // (this is also the image-baked-content guarantee — the runtime
    //  doesn't shadow what the agent image laid down).
    expect(merged).toContain("internal-ci.example.com:");
    expect(merged).toContain("user: ci-bot");
    expect(merged).toContain("git_protocol: ssh");
  });
});
