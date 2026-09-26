import { describe, it, expect } from "vitest";
import { detectHost } from "../../modules/skills/domain/git-host.js";

describe("detectHost", () => {
  it("parses GitHub HTTPS URLs", () => {
    expect(detectHost("https://github.com/foo/bar")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("tolerates a trailing .git and/or trailing slash", () => {
    expect(detectHost("https://github.com/foo/bar.git")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
    expect(detectHost("https://github.com/foo/bar/")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
    expect(detectHost("https://github.com/foo/bar.git/")).toEqual({
      kind: "github",
      owner: "foo",
      repo: "bar",
    });
  });

  it("returns null for unsupported hosts", () => {
    expect(detectHost("https://gitlab.com/foo/bar")).toBeNull();
    expect(detectHost("git@github.com:foo/bar.git")).toBeNull();
    expect(detectHost("not-a-url")).toBeNull();
  });
});
