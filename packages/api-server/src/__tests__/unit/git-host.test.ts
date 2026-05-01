import { describe, it, expect } from "vitest";
import { detectHost, redactToken } from "../../modules/skills/infrastructure/git-host.js";

describe("detectHost", () => {
  it("parses GitHub HTTPS URLs", () => {
    expect(detectHost("https://github.com/foo/bar")).toEqual({ kind: "github", owner: "foo", repo: "bar" });
  });

  it("tolerates a trailing .git and/or trailing slash", () => {
    expect(detectHost("https://github.com/foo/bar.git")).toEqual({ kind: "github", owner: "foo", repo: "bar" });
    expect(detectHost("https://github.com/foo/bar/")).toEqual({ kind: "github", owner: "foo", repo: "bar" });
    expect(detectHost("https://github.com/foo/bar.git/")).toEqual({ kind: "github", owner: "foo", repo: "bar" });
  });

  it("returns null for unsupported hosts", () => {
    expect(detectHost("https://gitlab.com/foo/bar")).toBeNull();
    expect(detectHost("git@github.com:foo/bar.git")).toBeNull();
    expect(detectHost("not-a-url")).toBeNull();
  });
});

describe("redactToken", () => {
  it("redacts x-access-token URLs", () => {
    const msg = "fatal: https://x-access-token:github_pat_abc@github.com/foo/bar.git not found";
    expect(redactToken(msg)).toBe("fatal: https://[redacted]@github.com/foo/bar.git not found");
  });

  it("leaves clean messages untouched", () => {
    expect(redactToken("nothing to commit, working tree clean")).toBe("nothing to commit, working tree clean");
  });

  it("redacts multiple occurrences", () => {
    const msg = "cloning https://u:p@a.com/... and https://x:y@b.com/...";
    expect(redactToken(msg)).toBe("cloning https://[redacted]@a.com/... and https://[redacted]@b.com/...");
  });
});
