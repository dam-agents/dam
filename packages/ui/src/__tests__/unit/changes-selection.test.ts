import type { ChangeSet } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import {
  changeSetLabel,
  groupChangeSets,
  hasNewChanges,
} from "../../modules/changes/lib/change-set-groups.js";
import { fileDiffBody } from "../../modules/changes/lib/diff-layout.js";
import {
  choose,
  initialSelection,
} from "../../modules/changes/lib/selection.js";

// TEST_OVERVIEW: the Changes panel's choice of change set — the groups its select lists, the change set it opens on, and the "new changes" dot it shows instead of switching by itself when the agent edits another one.

function changeSet(
  path: string,
  overrides: Partial<ChangeSet> = {},
): ChangeSet {
  return {
    path,
    repository: { id: `${path}/.git`, name: "acme/app", root: path },
    branch: "main",
    baseRef: "origin/main",
    stat: { files: 0, additions: 0, deletions: 0 },
    commitsAhead: 0,
    uncommitted: false,
    pullRequest: null,
    sessionEditedAt: null,
    readError: null,
    ...overrides,
  };
}

const edited = (path: string, at: string, overrides: Partial<ChangeSet> = {}) =>
  changeSet(path, {
    sessionEditedAt: at,
    uncommitted: true,
    stat: { files: 1, additions: 1, deletions: 0 },
    ...overrides,
  });

describe("change set groups", () => {
  // TEST_SCENARIO: the select lists what this session changed first, most recently edited on top, then other repositories with changes, then the clean ones.
  it("groups change sets in the order the select shows them", () => {
    const groups = groupChangeSets([
      changeSet("/clean"),
      changeSet("/dirty", { uncommitted: true }),
      edited("/older", "2026-10-14T09:00:00.000Z"),
      edited("/tmp/tmp.x", "2026-10-14T10:00:00.000Z"),
      changeSet("/ahead", { commitsAhead: 2 }),
    ]);

    expect(groups.map((g) => [g.id, g.changeSets.map((c) => c.path)])).toEqual([
      ["session", ["/tmp/tmp.x", "/older"]],
      ["changed", ["/dirty", "/ahead"]],
      ["clean", ["/clean"]],
    ]);
  });

  // TEST_SCENARIO: the filter on top of the list matches repository name, branch or path.
  it("filters by repository, branch or path", () => {
    const sets = [
      changeSet("/home/agent/work/slots/1", { branch: "feat/one" }),
      changeSet("/home/agent/work/slots/2", { branch: "fix/two" }),
    ];

    expect(
      groupChangeSets(sets, "fix/").flatMap((g) =>
        g.changeSets.map((c) => c.path),
      ),
    ).toEqual(["/home/agent/work/slots/2"]);
    expect(groupChangeSets(sets, "nothing")).toEqual([]);
  });

  // TEST_SCENARIO: two worktrees of one repository share a name; their labels differ by branch, and the select also always shows the path.
  it("labels worktrees of one repository by branch", () => {
    expect(changeSetLabel(changeSet("/a", { branch: "feat/one" }))).toBe(
      "acme/app · feat/one",
    );
    expect(changeSetLabel(changeSet("/b", { branch: null }))).toBe(
      "acme/app · detached",
    );
  });
});

describe("change set selection", () => {
  // TEST_SCENARIO: the panel opens on the change set the agent edited last in this session.
  it("selects the change set edited last", () => {
    const selection = initialSelection([
      edited("/a", "2026-10-14T09:00:00.000Z"),
      edited("/b", "2026-10-14T10:00:00.000Z"),
      changeSet("/c", { uncommitted: true }),
    ]);

    expect(selection.path).toBe("/b");
  });

  // TEST_SCENARIO: a session that edited nothing selects nothing, so the panel shows the list to choose from.
  it("selects nothing when the session edited nothing", () => {
    expect(
      initialSelection([changeSet("/a", { uncommitted: true })]).path,
    ).toBeNull();
  });

  // TEST_SCENARIO: when the agent goes on to edit another change set, the selection stays and the other one gets a "new changes" dot; choosing it clears the dot, and edits made to a change set while it was selected leave no dot behind.
  it("marks new edits elsewhere instead of switching", () => {
    const first = [edited("/a", "2026-10-14T09:00:00.000Z"), changeSet("/b")];
    const selection = initialSelection(first);
    const later = [
      edited("/a", "2026-10-14T09:30:00.000Z"),
      edited("/b", "2026-10-14T10:00:00.000Z"),
    ];

    expect(selection.path).toBe("/a");
    expect(hasNewChanges(later[1]!, selection.seen, selection.path)).toBe(true);
    expect(hasNewChanges(later[0]!, selection.seen, selection.path)).toBe(
      false,
    );

    const switched = choose(selection, later, "/b");

    expect(hasNewChanges(later[1]!, switched.seen, switched.path)).toBe(false);
    expect(hasNewChanges(later[0]!, switched.seen, switched.path)).toBe(false);
  });
});

describe("file diff body", () => {
  const file = {
    path: "a.ts",
    oldPath: null,
    status: "modified" as const,
    additions: 1,
    deletions: 1,
    binary: false,
    uncommitted: false,
    patch: "diff --git a/a.ts b/a.ts\n",
  };

  // TEST_SCENARIO: large diffs start collapsed, and binary or oversized files say so instead of rendering.
  it("collapses big files and names what it cannot show", () => {
    expect(fileDiffBody(file, null)).toBe("shown");
    expect(fileDiffBody({ ...file, additions: 5000 }, null)).toBe("collapsed");
    expect(fileDiffBody({ ...file, binary: true }, null)).toBe("binary");
    expect(fileDiffBody({ ...file, patch: null }, null)).toBe("too-large");
  });

  // TEST_SCENARIO: a watch refetch can grow a file past the patch cap or shrink it back under it; the body follows the current file, and only the user's expand or collapse choice carries over.
  it("follows the current file and keeps only the user's choice", () => {
    expect(fileDiffBody({ ...file, patch: null }, true)).toBe("too-large");
    expect(fileDiffBody(file, false)).toBe("collapsed");
    expect(fileDiffBody({ ...file, additions: 5000 }, true)).toBe("shown");
  });
});
