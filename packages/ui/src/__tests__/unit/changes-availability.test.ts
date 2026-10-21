import type { ChangeSet } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import { hasGitRepositories } from "../../modules/changes/lib/availability.js";

// TEST_OVERVIEW: the answer the change set list gives about an agent's repositories, which decides if the Changes tab exists. A settled list holds one entry per repository, so an empty one is an agent with no repository. A list that has not arrived, or one that stands in for another agent's list after a switch, answers nothing.

const answer = (changeSets: ChangeSet[] | undefined, placeholder = false) => ({
  data: changeSets === undefined ? undefined : { changeSets },
  isPlaceholderData: placeholder,
});

const changeSet: ChangeSet = {
  path: "/home/agent/app",
  repository: {
    id: "/home/agent/app/.git",
    name: "acme/app",
    root: "/home/agent/app",
  },
  branch: "main",
  baseRef: "origin/main",
  stat: { files: 0, additions: 0, deletions: 0 },
  commitsAhead: 0,
  uncommitted: false,
  pullRequest: null,
  sessionEditedAt: null,
  readError: null,
};

describe("the repositories the change set list answers for", () => {
  it("TEST_SCENARIO: a settled list of one change set is a repository, and a settled empty list is none", () => {
    expect(hasGitRepositories(answer([changeSet]))).toBe(true);
    expect(hasGitRepositories(answer([]))).toBe(false);
  });

  it("TEST_SCENARIO: switching from an agent without a repository to one with a repository answers nothing while the previous agent's empty list stands in, so the switch carries no verdict over to the new agent", () => {
    expect(hasGitRepositories(answer([], true))).toBe(undefined);
    expect(hasGitRepositories(answer(undefined, true))).toBe(undefined);
    expect(hasGitRepositories(answer(undefined))).toBe(undefined);
  });
});
