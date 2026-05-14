import { describe, expect, it } from "vitest";
import { groupGithubPats, type SecretLike } from "../modules/agent/lib/group-github-pats.js";

function s(id: string, name: string, hostPattern: string, type = "generic"): SecretLike {
  return { id, name, type, hostPattern };
}

describe("groupGithubPats", () => {
  it("returns empty for empty input", () => {
    expect(groupGithubPats([])).toEqual([]);
  });

  it("returns one entry for a complete pair", () => {
    const pairs = groupGithubPats([
      s("api-1", "alice", "api.github.com"),
      s("git-1", "alice", "github.com"),
    ]);
    expect(pairs).toEqual([{ name: "alice", apiSecretId: "api-1", gitSecretId: "git-1" }]);
  });

  it("returns multiple pairs sorted by name", () => {
    const pairs = groupGithubPats([
      s("git-b", "bob", "github.com"),
      s("api-a", "alice", "api.github.com"),
      s("api-b", "bob", "api.github.com"),
      s("git-a", "alice", "github.com"),
    ]);
    expect(pairs.map((p) => p.name)).toEqual(["alice", "bob"]);
  });

  it("drops orphan with only api.github.com half", () => {
    expect(groupGithubPats([s("api-1", "alice", "api.github.com")])).toEqual([]);
  });

  it("drops group with duplicate halves on the same host", () => {
    expect(
      groupGithubPats([
        s("api-1", "alice", "api.github.com"),
        s("api-2", "alice", "api.github.com"),
      ]),
    ).toEqual([]);
  });

  it("ignores non-GitHub secrets and keeps only complete pairs", () => {
    const pairs = groupGithubPats([
      s("anthropic-1", "Anthropic", "api.anthropic.com", "anthropic"),
      s("api-1", "alice", "api.github.com"),
      s("git-1", "alice", "github.com"),
      s("api-2", "orphan", "api.github.com"),
    ]);
    expect(pairs).toEqual([{ name: "alice", apiSecretId: "api-1", gitSecretId: "git-1" }]);
  });
});
