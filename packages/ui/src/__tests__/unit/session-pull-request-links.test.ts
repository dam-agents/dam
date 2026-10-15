import type { SessionRepository } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import { pullRequestLinks } from "../../modules/changes/lib/pull-request-links.js";

// TEST_OVERVIEW: the pull request links the chat shows under the message box — one per pull request the session's repositories link, named by repository and number.

function repository(
  path: string,
  overrides: Partial<SessionRepository> = {},
): SessionRepository {
  return {
    name: "dam-agents/dam",
    path,
    branch: "fix/one",
    pullRequest: null,
    ...overrides,
  };
}

const pr = (number: number) => ({
  number,
  url: `https://github.com/dam-agents/dam/pull/${number}`,
});

describe("session pull request links", () => {
  // TEST_SCENARIO: a session that opened a pull request shows it as "<repository> #<number>", linking to GitHub.
  it("names a pull request by repository and number", () => {
    expect(
      pullRequestLinks([repository("/a", { pullRequest: pr(5053) })]),
    ).toEqual([
      {
        label: "dam #5053",
        title: "dam-agents/dam#5053 · fix/one",
        url: "https://github.com/dam-agents/dam/pull/5053",
      },
    ]);
  });

  // TEST_SCENARIO: repositories without a pull request show nothing, and a session the list has no repositories for shows no link.
  it("shows nothing for a repository without a pull request", () => {
    expect(pullRequestLinks([repository("/a")])).toEqual([]);
    expect(pullRequestLinks(undefined)).toEqual([]);
  });

  // TEST_SCENARIO: two worktrees on one branch link the same pull request; it shows once, and another pull request shows beside it.
  it("shows each pull request once", () => {
    expect(
      pullRequestLinks([
        repository("/a", { pullRequest: pr(1) }),
        repository("/b", { pullRequest: pr(1) }),
        repository("/c", { branch: null, pullRequest: pr(2) }),
      ]).map((link) => [link.label, link.title]),
    ).toEqual([
      ["dam #1", "dam-agents/dam#1 · fix/one"],
      ["dam #2", "dam-agents/dam#2"],
    ]);
  });
});
