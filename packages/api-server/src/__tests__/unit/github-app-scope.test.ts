import { describe, it, expect } from "vitest";
import {
  parseGitHubAppScope,
  parsePermissions,
  parseRepositories,
  parseRepositoryIds,
} from "../../modules/connections/domain/github-app-scope.js";

describe("parseRepositories", () => {
  it("treats absent, empty, and whitespace-only input as no narrowing", () => {
    expect(parseRepositories(undefined)).toBeUndefined();
    expect(parseRepositories("")).toBeUndefined();
    expect(parseRepositories("   ")).toBeUndefined();
  });

  it("splits on spaces, commas, and newlines alike", () => {
    expect(parseRepositories("docs handbook")).toEqual(["docs", "handbook"]);
    expect(parseRepositories("docs,handbook")).toEqual(["docs", "handbook"]);
    expect(parseRepositories("docs, handbook")).toEqual(["docs", "handbook"]);
    expect(parseRepositories("docs\nhandbook")).toEqual(["docs", "handbook"]);
  });

  it("accepts the punctuation GitHub allows in a repository name", () => {
    expect(parseRepositories("my-repo my.repo my_repo r2")).toEqual([
      "my-repo",
      "my.repo",
      "my_repo",
      "r2",
    ]);
  });

  it("drops duplicates while preserving order", () => {
    expect(parseRepositories("docs handbook docs")).toEqual([
      "docs",
      "handbook",
    ]);
  });

  it("rejects owner/name and names the repository to use instead", () => {
    expect(() => parseRepositories("dam-agents/docs")).toThrow(
      /just the repository name.*"docs"/s,
    );
  });

  it("names the repository from a pasted repository URL too", () => {
    expect(() =>
      parseRepositories("https://github.com/dam-agents/docs"),
    ).toThrow(/just the repository name.*"docs"/s);
  });

  it("suggests nothing rather than a replacement that would fail again", () => {
    for (const bad of ["dam-agents/docs/", "docs/", "owner/docs!"]) {
      expect(() => parseRepositories(bad)).toThrow(/without the owner\.$/);
    }
  });

  it("rejects a name with characters GitHub does not allow", () => {
    expect(() => parseRepositories("do cs")).not.toThrow();
    expect(() => parseRepositories("docs!")).toThrow(/not a valid repository/);
  });

  it("rejects more repositories than one request may carry", () => {
    const many = Array.from({ length: 501 }, (_, i) => `r${i}`).join(" ");
    expect(() => parseRepositories(many)).toThrow(/at most 500/);
  });

  it("allows exactly the maximum", () => {
    const many = Array.from({ length: 500 }, (_, i) => `r${i}`).join(" ");
    expect(parseRepositories(many)).toHaveLength(500);
  });
});

describe("parsePermissions", () => {
  it("treats absent, empty, and whitespace-only input as no narrowing", () => {
    expect(parsePermissions(undefined)).toBeUndefined();
    expect(parsePermissions("")).toBeUndefined();
    expect(parsePermissions("   ")).toBeUndefined();
  });

  it("parses name:level pairs", () => {
    expect(parsePermissions("contents:read, issues:write")).toEqual({
      contents: "read",
      issues: "write",
    });
  });

  it("accepts the underscored permission names GitHub uses", () => {
    expect(parsePermissions("pull_requests:write")).toEqual({
      pull_requests: "write",
    });
  });

  it("normalizes the level's case", () => {
    expect(parsePermissions("contents:READ")).toEqual({ contents: "read" });
  });

  it("lets a later duplicate correct an earlier one", () => {
    expect(parsePermissions("contents:write contents:read")).toEqual({
      contents: "read",
    });
  });

  it("rejects a pair with no level", () => {
    expect(() => parsePermissions("contents")).toThrow(/name:level/);
  });

  it("rejects a level GitHub does not accept", () => {
    expect(() => parsePermissions("contents:readonly")).toThrow(
      /:read, :write, or :admin/,
    );
  });

  it("rejects an invalid permission name", () => {
    expect(() => parsePermissions("Contents:read")).toThrow(
      /invalid permission name/,
    );
  });
});

describe("parseRepositoryIds", () => {
  it("treats absent, empty, and whitespace-only input as no narrowing", () => {
    expect(parseRepositoryIds(undefined)).toBeUndefined();
    expect(parseRepositoryIds("")).toBeUndefined();
    expect(parseRepositoryIds("   ")).toBeUndefined();
  });

  it("parses ids and drops duplicates", () => {
    expect(parseRepositoryIds("12 34, 12")).toEqual([12, 34]);
  });

  it("rejects anything that is not a whole number", () => {
    for (const bad of ["12abc", "1.5", "-3", "0x10", "1e3"]) {
      expect(() => parseRepositoryIds(bad)).toThrow(/whole number/);
    }
  });

  it("rejects an id beyond safe integer range", () => {
    expect(() => parseRepositoryIds("9007199254740993")).toThrow(
      /out of range/,
    );
  });

  it("rejects more repositories than one request may carry", () => {
    const many = Array.from({ length: 501 }, (_, i) => i + 1).join(" ");
    expect(() => parseRepositoryIds(many)).toThrow(/at most 500/);
  });
});

describe("parseGitHubAppScope", () => {
  it("omits both halves when neither is given", () => {
    expect(parseGitHubAppScope({})).toEqual({});
  });

  it("narrows on repositories alone", () => {
    expect(parseGitHubAppScope({ repositories: "docs" })).toEqual({
      repositories: ["docs"],
    });
  });

  it("narrows on permissions alone", () => {
    expect(parseGitHubAppScope({ permissions: "contents:read" })).toEqual({
      permissions: { contents: "read" },
    });
  });

  it("carries both halves when both are given", () => {
    expect(
      parseGitHubAppScope({
        repositories: "docs",
        permissions: "contents:read",
      }),
    ).toEqual({ repositories: ["docs"], permissions: { contents: "read" } });
  });

  it("narrows on repository ids alone", () => {
    expect(parseGitHubAppScope({ repositoryIds: "12 34" })).toEqual({
      repositoryIds: [12, 34],
    });
  });

  it("drops names when ids are also given", () => {
    expect(
      parseGitHubAppScope({ repositories: "docs", repositoryIds: "12" }),
    ).toEqual({ repositoryIds: [12] });
  });

  it("still validates names when no ids are given", () => {
    expect(() =>
      parseGitHubAppScope({ repositories: "dam-agents/docs" }),
    ).toThrow(/just the repository name/);
  });
});
