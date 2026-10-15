import { describe, expect, it } from "vitest";

import {
  parseNumstat,
  parseStatus,
  parseWorktreeList,
  repositoryNameOf,
  splitPatch,
} from "../../modules/changes/domain/git-output.js";
import { createToolActivityReader } from "../../modules/changes/domain/tool-activity.js";
import { INERT_GITHUB_TOKEN } from "../../modules/skills/infrastructure/github-token.js";
import { createPullRequestFinder } from "../../modules/changes/infrastructure/pull-requests.js";

/**
 * TEST_OVERVIEW: the parts of the Changes panel's runtime that read text —
 * git's porcelain output, ACP tool-call frames — and the pull request lookup
 * that goes through the agent's GitHub connection.
 */

describe("git output parsing", () => {
  /**
   * TEST_SCENARIO: `git worktree list --porcelain` gives a block per
   * worktree; a detached one has no branch and a pruned one is skipped.
   */
  it("should read worktrees with their branches", () => {
    const output = [
      "worktree /r",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /r/slot",
      "HEAD def",
      "detached",
      "",
      "worktree /gone",
      "HEAD 123",
      "branch refs/heads/old",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");

    expect(parseWorktreeList(output)).toEqual([
      { path: "/r", head: "abc", branch: "main" },
      { path: "/r/slot", head: "def", branch: null },
    ]);
  });

  /**
   * TEST_SCENARIO: A rename in `--numstat -z` carries an empty path field
   * followed by the old and new path.
   */
  it("should read renames out of numstat", () => {
    const output =
      "1\t2\ta.txt\0" + "0\t0\t\0old.txt\0new.txt\0" + "-\t-\tlogo.png\0";

    expect(parseNumstat(output)).toEqual([
      {
        path: "a.txt",
        oldPath: null,
        additions: 1,
        deletions: 2,
        binary: false,
      },
      {
        path: "new.txt",
        oldPath: "old.txt",
        additions: 0,
        deletions: 0,
        binary: false,
      },
      {
        path: "logo.png",
        oldPath: null,
        additions: 0,
        deletions: 0,
        binary: true,
      },
    ]);
  });

  /**
   * TEST_SCENARIO: A nested repository shows in status as a directory entry
   * ending in a slash; it is not a file of this repository.
   */
  it("should drop nested repositories from status", () => {
    const output = " M a.txt\0?? nested/\0?? new.txt\0R  b.txt\0old-b.txt\0";

    expect(parseStatus(output)).toEqual([
      { path: "a.txt", untracked: false },
      { path: "new.txt", untracked: true },
      { path: "b.txt", untracked: false },
    ]);
  });

  /**
   * TEST_SCENARIO: A combined patch splits into one patch per file, keyed by
   * the file's path after the change, a deleted file by its old path.
   */
  it("should split a patch per file", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "diff --git a/gone.txt b/gone.txt",
      "deleted file mode 100644",
      "--- a/gone.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-z",
      "diff --git a/old.txt b/new.txt",
      "similarity index 100%",
      "rename from old.txt",
      "rename to new.txt",
      "",
    ].join("\n");

    const chunks = splitPatch(patch);

    expect([...chunks.keys()]).toEqual(["a.txt", "gone.txt", "new.txt"]);
    expect(chunks.get("a.txt")).toBe(
      "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+y\n",
    );
  });

  /**
   * TEST_SCENARIO: A repository is named by its origin's owner/name, or by
   * its directory when it has no remote.
   */
  it("should name a repository by its remote", () => {
    expect(repositoryNameOf("git@github.com:acme/app.git", "/x")).toBe(
      "acme/app",
    );
    expect(repositoryNameOf("https://github.com/acme/app", "/x")).toBe(
      "acme/app",
    );
    expect(repositoryNameOf(null, "/tmp/tmp.abc")).toBe("tmp.abc");
  });
});

describe("tool activity", () => {
  /**
   * TEST_SCENARIO: An Edit tool call names the file it edits in its
   * locations and its raw input; both give the edited path once.
   */
  it("should read the paths an edit tool call touches", () => {
    const toolActivityIn = createToolActivityReader();
    const frame = {
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          kind: "edit",
          status: "pending",
          locations: [{ path: "/tmp/tmp.abc/x.md" }],
          rawInput: { file_path: "/tmp/tmp.abc/x.md" },
        },
      },
    };

    expect(toolActivityIn(frame)).toEqual({
      sessionId: "s1",
      editedPaths: ["/tmp/tmp.abc/x.md"],
      settled: false,
    });
  });

  /**
   * TEST_SCENARIO: A finished tool call of any kind may have changed files
   * (a shell command), so it is reported as settled with no edited paths;
   * an unfinished non-edit tool call is nothing.
   */
  it("should report a settled tool call without paths", () => {
    const toolActivityIn = createToolActivityReader();
    const update = (status: string) => ({
      params: {
        sessionId: "s1",
        update: { sessionUpdate: "tool_call_update", kind: "execute", status },
      },
    });

    expect(toolActivityIn(update("completed"))).toEqual({
      sessionId: "s1",
      editedPaths: [],
      settled: true,
    });
    expect(toolActivityIn(update("in_progress"))).toBeNull();
  });

  const frameOf = (update: Record<string, unknown>) => ({
    method: "session/update",
    params: { sessionId: "s1", update: { toolCallId: "t1", ...update } },
  });

  /**
   * TEST_SCENARIO: A streamed Write opens as an edit with no locations, before
   * its input arrives; the update that names the file carries no kind. The
   * path still counts as edited, and the call settles once.
   */
  it("should read the path a streamed edit names in a later update", () => {
    const toolActivityIn = createToolActivityReader();

    expect(
      toolActivityIn(
        frameOf({ sessionUpdate: "tool_call", kind: "edit", locations: [] }),
      ),
    ).toBeNull();
    expect(
      toolActivityIn(
        frameOf({
          sessionUpdate: "tool_call_update",
          locations: [{ path: "/repo/a.ts" }],
        }),
      ),
    ).toEqual({ sessionId: "s1", editedPaths: ["/repo/a.ts"], settled: false });
    expect(
      toolActivityIn(
        frameOf({ sessionUpdate: "tool_call_update", status: "completed" }),
      ),
    ).toEqual({ sessionId: "s1", editedPaths: [], settled: true });
  });

  /**
   * TEST_SCENARIO: A Read names the file it reads in a later update too; a
   * tool call that opened as another kind edits nothing, and neither does a
   * call of the same id in another session.
   */
  it("should not count the locations of a tool call that is not an edit", () => {
    const toolActivityIn = createToolActivityReader();
    toolActivityIn(frameOf({ sessionUpdate: "tool_call", kind: "edit" }));
    toolActivityIn({
      params: {
        sessionId: "s2",
        update: { sessionUpdate: "tool_call", toolCallId: "t2", kind: "read" },
      },
    });

    expect(
      toolActivityIn({
        params: {
          sessionId: "s2",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t2",
            locations: [{ path: "/repo/a.ts" }],
          },
        },
      }),
    ).toBeNull();
    expect(
      toolActivityIn({
        params: {
          sessionId: "s2",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t1",
            locations: [{ path: "/repo/a.ts" }],
          },
        },
      }),
    ).toBeNull();
  });
});

describe("pull request finder", () => {
  /**
   * TEST_SCENARIO: Without a GitHub connection the agent holds only the inert
   * placeholder token, and no lookup is made: no connection, no link.
   */
  it("should not look up without a GitHub connection", async () => {
    let calls = 0;
    const finder = createPullRequestFinder({
      token: () => INERT_GITHUB_TOKEN,
      fetch: async () => {
        calls++;
        return new Response("[]");
      },
      log: () => undefined,
    });

    expect(
      await finder.find("https://github.com/acme/app.git", "feat/x"),
    ).toBeNull();
    expect(calls).toBe(0);
  });

  /**
   * TEST_SCENARIO: With a connection the open pull request of the branch is
   * looked up by head, and the answer is reused within its time to live.
   */
  it("should find the open pull request of a branch", async () => {
    const urls: string[] = [];
    const finder = createPullRequestFinder({
      token: () => "gateway-placeholder",
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify([
            { number: 12, html_url: "https://github.com/acme/app/pull/12" },
          ]),
        );
      },
      log: () => undefined,
    });

    const first = await finder.find("git@github.com:acme/app.git", "feat/x");
    const second = await finder.find("git@github.com:acme/app.git", "feat/x");

    expect(first).toEqual({
      number: 12,
      url: "https://github.com/acme/app/pull/12",
    });
    expect(second).toEqual(first);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(
      "/repos/acme/app/pulls?head=acme%3Afeat%2Fx&state=open",
    );
  });
});
