import type { SessionRepository } from "agent-runtime-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionRepositoryBadges } from "../../modules/changes/components/session-repository-badges.js";
import {
  badgeRepositories,
  pullRequestLinks,
} from "../../modules/changes/lib/pull-request-links.js";

// TEST_OVERVIEW: the pull request links the chat shows under the message box — one per pull request the session's repositories link, named by repository and number — and the repository badges in the sessions list: one per pull request.

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

describe("session repository badges", () => {
  // TEST_SCENARIO: a Session badges the repositories it has a pull request in, in their order, and none it only committed in; a Session the list has no repositories for badges none.
  it("badges only the repositories with a pull request", () => {
    const withPullRequest = repository("/work/dam", { pullRequest: pr(1) });
    const outsideHome = repository("/tmp/clone", { pullRequest: pr(2) });

    expect(
      badgeRepositories([
        repository("/home/agent/.cache/plugin"),
        withPullRequest,
        outsideHome,
      ]),
    ).toEqual([withPullRequest, outsideHome]);
    expect(badgeRepositories(undefined)).toEqual([]);
  });

  // TEST_SCENARIO: two clones of one repository on one branch link the same pull request; it badges once, as the clone edited last, and another pull request of the repository badges beside it.
  it("badges each pull request once", () => {
    const editedLast = repository("/work/slots/3", { pullRequest: pr(270) });
    const other = repository("/work/slots/2", {
      branch: "fix/two",
      pullRequest: pr(271),
    });

    expect(
      badgeRepositories([
        editedLast,
        repository("/work/slots/1", { pullRequest: pr(270) }),
        other,
      ]),
    ).toEqual([editedLast, other]);
  });

  // TEST_SCENARIO: a badge is named "<repository> #<number>" alone, never with the clone's slot, directory or branch, even when two pull requests of one repository come from two clones.
  it("names a badge by repository and number alone", () => {
    const html = renderToStaticMarkup(
      createElement(SessionRepositoryBadges, {
        repositories: badgeRepositories([
          repository("/work/slots/1", { pullRequest: pr(1) }),
          repository("/work/slots/2", { pullRequest: pr(2) }),
          repository("/work/slots/3", { branch: null, pullRequest: pr(1) }),
        ]),
      }),
    );
    const labels = [
      ...html.matchAll(/<span class="truncate">([^<]*)<\/span>/g),
    ].map((match) => match[1]);

    expect(labels).toEqual(["dam", "dam"]);
    expect(html.match(/#\d+/g)).toEqual(["#1", "#2"]);
  });
});
