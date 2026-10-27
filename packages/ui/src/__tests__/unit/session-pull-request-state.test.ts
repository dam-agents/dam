import type { PullRequestLink, SessionRepository } from "agent-runtime-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionRepositoryBadges } from "../../modules/changes/components/session-repository-badges.js";
import { pullRequestStatus } from "../../modules/changes/lib/pull-request-state.js";

// TEST_OVERVIEW: a repository badge in the sessions list shows where its pull request stands: its color follows the pull request's state, the way Claude Code colors its pull request indicator, and its tooltip names the state, so the color is not the only signal.

function link(overrides: Partial<PullRequestLink> = {}): PullRequestLink {
  return {
    number: 7,
    url: "https://github.com/acme/dam/pull/7",
    state: "pending",
    conflicts: false,
    ...overrides,
  };
}

function badge(pullRequest: PullRequestLink): string {
  const repository: SessionRepository = {
    name: "acme/dam",
    path: "/work/dam",
    branch: "fix/one",
    pullRequest,
  };
  return renderToStaticMarkup(
    createElement(SessionRepositoryBadges, { repositories: [repository] }),
  );
}

describe("pull request badge state", () => {
  // TEST_SCENARIO: each review state has its own color from the issue's table — gray draft, yellow pending, green approved, red changes requested, purple merged — and a closed pull request is red but struck through, so it is not read as changes requested.
  it("colors the badge by the pull request's state", () => {
    const of = (state: PullRequestLink["state"]) =>
      pullRequestStatus(link({ state }));

    expect(of("draft")).toEqual({
      variant: "muted",
      label: "Draft",
      struck: false,
    });
    expect(of("pending")).toMatchObject({
      variant: "pending",
      label: "Review pending",
    });
    expect(of("approved")).toMatchObject({
      variant: "success",
      label: "Approved",
    });
    expect(of("changes-requested")).toMatchObject({
      variant: "danger",
      label: "Changes requested",
      struck: false,
    });
    expect(of("merged")).toMatchObject({
      variant: "template",
      label: "Merged",
    });
    expect(of("closed")).toEqual({
      variant: "danger",
      label: "Closed",
      struck: true,
    });
  });

  // TEST_SCENARIO: merge conflicts show over the review color of an open pull request, and the tooltip still names the review state under them; a runtime that reports no state keeps the muted badge it had before.
  it("shows merge conflicts over the review state", () => {
    expect(
      pullRequestStatus(link({ state: "approved", conflicts: true })),
    ).toEqual({
      variant: "conflict",
      label: "Merge conflicts · Approved",
      struck: false,
    });
    expect(
      pullRequestStatus({
        number: 7,
        url: "https://github.com/acme/dam/pull/7",
      }),
    ).toEqual({ variant: "muted", label: null, struck: false });
  });

  // TEST_SCENARIO: the badge a user hovers names the pull request's state in its tooltip, and the closed one strikes its number through.
  it("names the state in the badge's tooltip", () => {
    const approved = badge(link({ state: "approved" }));
    expect(approved).toContain("Pull request #7: Approved");
    expect(approved).toContain("bg-success-light");

    const closed = badge(link({ state: "closed" }));
    expect(closed).toContain("Pull request #7: Closed");
    expect(closed).toContain("line-through");
  });
});
