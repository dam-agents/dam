import { describe, expect, it } from "vitest";

import {
  parseNumstat,
  parseStatus,
  parseWorktreeList,
  repositoryNameOf,
  splitPatch,
} from "../../modules/changes/domain/git-output.js";
import { createToolActivityReader } from "../../modules/changes/domain/tool-activity.js";
import {
  gitCommandOf,
  gitTraceEnv,
  PLATFORM_SESSION_ENV_VAR,
  sessionEnvVarsOf,
} from "../../modules/changes/domain/git-trace.js";
import { INERT_GITHUB_TOKEN } from "../../modules/skills/infrastructure/github-token.js";
import { createPullRequestFinder } from "../../modules/changes/infrastructure/pull-requests.js";

/**
 * TEST_OVERVIEW: the parts of the Changes panel's runtime that read text —
 * git's porcelain output, git's trace of a command, ACP tool-call frames —
 * and the pull request lookup that goes through the agent's GitHub
 * connection.
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
  const frame = (update: Record<string, unknown>) => ({
    method: "session/update",
    params: { sessionId: "s1", update },
  });

  /**
   * TEST_SCENARIO: A tool call that finished, completed or failed, names its
   * Session; one still running, a new one, or any other update is nothing.
   * What the tool call did is not read.
   */
  it("should name the Session of a tool call that finished", () => {
    const toolActivityIn = createToolActivityReader();
    const update = (sessionUpdate: string, status: string) =>
      frame({ sessionUpdate, toolCallId: "t1", kind: "edit", status });

    expect(toolActivityIn(update("tool_call_update", "completed"))).toEqual({
      sessionId: "s1",
    });
    expect(toolActivityIn(update("tool_call_update", "failed"))).toEqual({
      sessionId: "s1",
    });
    expect(
      toolActivityIn(update("tool_call_update", "in_progress")),
    ).toBeNull();
    expect(toolActivityIn(update("tool_call", "pending"))).toBeNull();
    expect(
      toolActivityIn(frame({ sessionUpdate: "agent_message_chunk" })),
    ).toBeNull();
  });
});

describe("git trace", () => {
  const vars = sessionEnvVarsOf([
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_THREAD_ID",
    "PI_SESSION_ID",
  ]);
  const commandOf = (text: string) => gitCommandOf(text, vars);

  const event = (fields: Record<string, unknown>, sid = "20261021T1-P1") =>
    JSON.stringify({ sid, thread: "main", ...fields });

  const trace = (
    name: string,
    opts: {
      code?: number;
      params?: Record<string, string>;
      worktree?: string;
    } = {},
  ) =>
    [
      event({ event: "version", evt: "4", exe: "2.47.3" }),
      event({
        event: "start",
        argv: ["git", name, "-m", "token=abc123"],
      }),
      ...(opts.worktree === undefined
        ? [event({ event: "def_repo", repo: 1, worktree: "/w/app" })]
        : opts.worktree === ""
          ? []
          : [event({ event: "def_repo", repo: 1, worktree: opts.worktree })]),
      event({ event: "cmd_name", name, hierarchy: name }),
      ...Object.entries(opts.params ?? {}).map(([param, value]) =>
        event({ event: "def_param", scope: "command", param, value }),
      ),
      event({ event: "exit", code: opts.code ?? 0 }),
      event({ event: "atexit", code: opts.code ?? 0 }),
    ].join("\n") + "\n";

  /**
   * TEST_SCENARIO: A commit that succeeded gives its worktree and the Session
   * its harness named; the command line it carries, which may hold a
   * secret, is not part of the result.
   */
  it("should read the worktree and Session of a commit", () => {
    const command = commandOf(
      trace("commit", { params: { CLAUDE_CODE_SESSION_ID: "s1" } }),
    );

    expect(command).toEqual({
      name: "commit",
      worktree: "/w/app",
      sessionId: "s1",
      push: false,
    });
    expect(JSON.stringify(command)).not.toContain("abc123");
  });

  /**
   * TEST_SCENARIO: A push is marked as one, and a trace that names no
   * Session still gives its command, for agent-runtime to decide.
   */
  it("should mark a push and keep a command that names no Session", () => {
    expect(commandOf(trace("push"))).toEqual({
      name: "push",
      worktree: "/w/app",
      sessionId: null,
      push: true,
    });
  });

  /**
   * TEST_SCENARIO: The platform's own variable wins over a harness's, and
   * among the harnesses' the one listed first wins.
   */
  it("should prefer the platform's Session variable", () => {
    expect(
      commandOf(
        trace("commit", {
          params: {
            PI_SESSION_ID: "pi",
            HARNESS_SESSION_ID: "term",
            CLAUDE_CODE_SESSION_ID: "cc",
          },
        }),
      )?.sessionId,
    ).toBe("term");
    expect(
      commandOf(
        trace("commit", {
          params: { PI_SESSION_ID: "pi", CODEX_THREAD_ID: "codex" },
        }),
      )?.sessionId,
    ).toBe("codex");
  });

  /**
   * TEST_SCENARIO: A command that only reads or switches, one that failed,
   * one outside any repository and an unfinished trace give nothing.
   */
  it("should give nothing for a command that records no work", () => {
    expect(commandOf(trace("status"))).toBeNull();
    expect(commandOf(trace("checkout"))).toBeNull();
    expect(commandOf(trace("commit", { code: 1 }))).toBeNull();
    expect(commandOf(trace("commit", { worktree: "" }))).toBeNull();
    expect(
      commandOf(trace("commit").split("\n").slice(0, 4).join("\n")),
    ).toBeNull();
  });

  /**
   * TEST_SCENARIO: A child git process a command starts writes into the
   * same trace under a nested id; only the command's own events count, so a
   * maintenance run inside a commit does not change its result.
   */
  it("should read only the top-level process of a trace", () => {
    const child = (fields: Record<string, unknown>) =>
      event(fields, "20261021T1-P1/20261021T2-P2");
    const text = [
      ...trace("commit", { params: { CLAUDE_CODE_SESSION_ID: "s1" } })
        .trim()
        .split("\n")
        .slice(0, -2),
      child({ event: "def_repo", repo: 1, worktree: "/other" }),
      child({ event: "cmd_name", name: "maintenance" }),
      child({ event: "exit", code: 1 }),
      event({ event: "exit", code: 0 }),
      event({ event: "atexit", code: 0 }),
    ].join("\n");

    expect(commandOf(text)).toMatchObject({
      name: "commit",
      worktree: "/w/app",
    });
  });

  /**
   * TEST_SCENARIO: A pull brings in work done elsewhere, so it records
   * nothing, and neither does the merge or rebase it starts as a process of
   * its own; a merge or rebase the agent runs itself still records.
   */
  it("should give nothing for a pull or the merge it starts", () => {
    const params = { CLAUDE_CODE_SESSION_ID: "s1" };
    const startedBy = (parent: string, name: string) =>
      trace(name, { params }).replace(
        `"hierarchy":"${name}"`,
        `"hierarchy":"${parent}/${name}"`,
      );

    expect(commandOf(trace("pull", { params }))).toBeNull();
    expect(commandOf(startedBy("pull", "merge"))).toBeNull();
    expect(commandOf(startedBy("pull", "rebase"))).toBeNull();
    expect(commandOf(trace("merge", { params }))?.name).toBe("merge");
    expect(commandOf(startedBy("_run_dashed_", "rebase"))?.name).toBe("rebase");
  });

  /**
   * TEST_SCENARIO: The trace configuration writes one file per git process
   * into a directory and records only the Session variables.
   */
  it("should configure a per-process trace with only the Session variables", () => {
    expect(
      gitTraceEnv("/home/agent/.platform/git-traces", ["A_ID", "B_ID"]),
    ).toMatchObject({
      GIT_TRACE2_EVENT: "/home/agent/.platform/git-traces/",
      GIT_TRACE2_BRIEF: "1",
      GIT_TRACE2_ENV_VARS: "A_ID,B_ID",
    });
  });

  /**
   * TEST_SCENARIO: The Session variables are the platform's own first, then
   * each harness manifest's in order, each once; a harness that declares
   * none adds nothing.
   */
  it("should collect the Session variables the harness manifests declare", () => {
    expect(
      sessionEnvVarsOf([
        "CODEX_THREAD_ID",
        undefined,
        "PI_SESSION_ID",
        "CODEX_THREAD_ID",
      ]),
    ).toEqual([PLATFORM_SESSION_ENV_VAR, "CODEX_THREAD_ID", "PI_SESSION_ID"]);
    expect(sessionEnvVarsOf([])).toEqual([PLATFORM_SESSION_ENV_VAR]);
  });

  /**
   * TEST_SCENARIO: A variable no harness declares does not name a Session,
   * even when git recorded it.
   */
  it("should ignore a Session variable no harness declares", () => {
    expect(
      gitCommandOf(trace("commit", { params: { PI_SESSION_ID: "pi" } }), [
        PLATFORM_SESSION_ENV_VAR,
        "CLAUDE_CODE_SESSION_ID",
      ])?.sessionId,
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
