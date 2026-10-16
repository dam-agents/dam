import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { runOnce } from "../../core/run-once.js";
import { runGit } from "../../modules/changes/infrastructure/git.js";
import type { PullRequestFinder } from "../../modules/changes/infrastructure/pull-requests.js";
import { createTouchedRepositoryStore } from "../../modules/changes/infrastructure/touched-repositories.js";
import {
  createChangesService,
  type ChangesRuntime,
} from "../../modules/changes/services/changes-service.js";

/**
 * TEST_OVERVIEW: the changes service finds every git repository the agent
 * has and reads each worktree as a change set, against real repositories on
 * disk. $HOME may itself be a repository with others nested inside it, a
 * repository may have several worktrees, and a session may edit a repository
 * outside $HOME (a clone in /tmp). The diff against base must give the same
 * files and lines as `git diff <merge-base>`. Each spec runs tens of git
 * processes, so a loaded machine needs more than vitest's defaults: 30 s per
 * spec and 20 s for the service to settle.
 */

let tmp: string;
let home: string;
let elsewhere: string;
let service: ChangesRuntime;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runOnce({
    command: [
      "git",
      "-c",
      "user.email=bench@example.com",
      "-c",
      "user.name=Bench",
      "-c",
      "init.defaultBranch=main",
      "-C",
      cwd,
      ...args,
    ],
    timeoutMs: 30_000,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value.stdout;
}

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

async function repository(dir: string, files: Record<string, string>) {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, "init", "--quiet");
  for (const [name, content] of Object.entries(files))
    await write(path.join(dir, name), content);
  await git(dir, "add", "-A");
  await git(dir, "commit", "--quiet", "-m", "initial");
}

const settles = { timeout: 20_000 };

const noPullRequests: PullRequestFinder = { find: async () => null };

function serviceFor(
  roots: string[],
  pullRequests: PullRequestFinder = noPullRequests,
  log: (msg: string) => void = () => undefined,
): ChangesRuntime {
  return createChangesService({
    roots,
    git: runGit,
    touched: createTouchedRepositoryStore(
      createFileDocumentStoreBackend(path.join(tmp, "state")),
    ),
    pullRequests,
    log,
    now: () => new Date("2026-10-14T10:00:00.000Z"),
  });
}

beforeEach(async () => {
  tmp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "changes-service-")),
  );
  home = path.join(tmp, "home");
  elsewhere = path.join(tmp, "elsewhere");
  service = serviceFor([path.join(home, "work"), home]);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("changes service", { timeout: 30_000 }, () => {
  /**
   * TEST_SCENARIO: $HOME is a repository and ignores work/, where another
   * repository lives. Each is its own entry, and the parent does not show the
   * nested repository's files as its own changes.
   */
  it("should list a nested repository apart from the $HOME repository", async () => {
    await repository(home, { ".gitignore": "work/\n", "notes.md": "a\n" });
    await repository(path.join(home, "work", "app"), { "src.ts": "x\n" });
    await write(path.join(home, "work", "app", "src.ts"), "y\n");
    await write(path.join(home, "notes.md"), "b\n");

    const { changeSets } = await service.list();

    expect(changeSets.map((c) => c.path).sort()).toEqual(
      [home, path.join(home, "work", "app")].sort(),
    );
    const parent = await service.diff(home, "uncommitted");
    expect(parent.ok && parent.value.files.map((f) => f.path)).toEqual([
      "notes.md",
    ]);
  });

  /**
   * TEST_SCENARIO: A repository nested in $HOME that $HOME does not ignore
   * shows in git status as an untracked directory; it must still not be
   * reported as the parent's change.
   */
  it("should not count an unignored nested repository as the parent's change", async () => {
    await repository(home, { "notes.md": "a\n" });
    await repository(path.join(home, "work", "app"), { "src.ts": "x\n" });

    const { changeSets } = await service.list();

    const parent = changeSets.find((c) => c.path === home);
    expect(parent?.uncommitted).toBe(false);
    expect(parent?.stat.files).toBe(0);
  });

  /**
   * TEST_SCENARIO: Two worktrees of one repository are two change sets under
   * the same repository, told apart by path and branch.
   */
  it("should group the worktrees of a repository under it", async () => {
    const main = path.join(home, "work", "app");
    await repository(main, { "a.txt": "a\n" });
    const linked = path.join(home, "work", "slots", "1");
    await git(main, "worktree", "add", "--quiet", "-b", "feat/one", linked);

    const { changeSets } = await service.list();

    const ids = new Set(changeSets.map((c) => c.repository.id));
    expect(ids.size).toBe(1);
    expect(changeSets.map((c) => [c.path, c.branch]).sort()).toEqual(
      [
        [main, "main"],
        [linked, "feat/one"],
      ].sort(),
    );
  });

  /**
   * TEST_SCENARIO: A branch with commits and uncommitted edits compares to
   * its merge-base with the default branch, giving the files and line counts
   * of `git diff <merge-base>`, commits ahead, and which files are still
   * uncommitted. An untracked file is part of the change too.
   */
  it("should diff a change set against its merge-base", async () => {
    const repo = path.join(home, "work", "app");
    await repository(repo, { "a.txt": "one\ntwo\n", "b.txt": "keep\n" });
    await git(repo, "checkout", "--quiet", "-b", "feat/x");
    await write(path.join(repo, "a.txt"), "one\nthree\n");
    await git(repo, "commit", "--quiet", "-am", "change a");
    await write(path.join(repo, "b.txt"), "keep\nmore\n");
    await write(path.join(repo, "new.txt"), "fresh\n");

    const { changeSets } = await service.list();
    const changeSet = changeSets.find((c) => c.path === repo)!;
    const diff = await service.diff(repo, "base");

    expect(changeSet).toMatchObject({
      branch: "feat/x",
      baseRef: "main",
      commitsAhead: 1,
      uncommitted: true,
      stat: { files: 3, additions: 3, deletions: 1 },
    });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    const mergeBase = (await git(repo, "merge-base", "HEAD", "main")).trim();
    const expected = await git(repo, "diff", "--numstat", mergeBase);
    expect(
      diff.value.files
        .filter((f) => f.path !== "new.txt")
        .map((f) => `${f.additions}\t${f.deletions}\t${f.path}`),
    ).toEqual(expected.trim().split("\n"));
    expect(
      diff.value.files.map((f) => [f.path, f.status, f.uncommitted]),
    ).toEqual([
      ["a.txt", "modified", false],
      ["b.txt", "modified", true],
      ["new.txt", "added", true],
    ]);
    expect(diff.value.files[0]!.patch).toContain("-two\n+three");
    expect(diff.value.files[2]!.patch).toContain("+fresh");
  });

  /**
   * TEST_SCENARIO: Comparing to Uncommitted shows only what is not committed
   * yet, against HEAD.
   */
  it("should diff only uncommitted changes against HEAD", async () => {
    const repo = path.join(home, "work", "app");
    await repository(repo, { "a.txt": "one\n", "b.txt": "two\n" });
    await git(repo, "checkout", "--quiet", "-b", "feat/x");
    await write(path.join(repo, "a.txt"), "changed\n");
    await git(repo, "commit", "--quiet", "-am", "change a");
    await write(path.join(repo, "b.txt"), "dirty\n");

    const diff = await service.diff(repo, "uncommitted");

    expect(diff.ok && diff.value.baseRef).toBe("HEAD");
    expect(diff.ok && diff.value.files.map((f) => f.path)).toEqual(["b.txt"]);
  });

  /**
   * TEST_SCENARIO: A session that edits a file in a repository outside the
   * scanned roots (a clone in /tmp) adds that repository to the list, marked
   * with when the session edited it, and records it for the sessions list.
   */
  it("should add a repository a session edited outside the roots", async () => {
    await repository(path.join(home, "work", "app"), { "a.txt": "a\n" });
    const clone = path.join(elsewhere, "tmp.abc");
    await repository(clone, { "x.md": "x\n" });
    await write(path.join(clone, "x.md"), "y\n");

    service.onToolActivity({
      sessionId: "s1",
      toolCallId: null,
      started: false,
      editedPaths: [path.join(clone, "x.md")],
      settled: false,
    });
    await expect
      .poll(() => service.repositoriesOf("s1").map((r) => r.path), settles)
      .toEqual([clone]);
    const { changeSets } = await service.list("s1");

    const edited = changeSets.find((c) => c.path === clone);
    expect(edited?.sessionEditedAt).toBe("2026-10-14T10:00:00.000Z");
    expect(
      changeSets.find((c) => c.path === path.join(home, "work", "app"))
        ?.sessionEditedAt,
    ).toBeNull();
    expect(service.repositoriesOf("s1")[0]).toMatchObject({
      name: "tmp.abc",
      branch: "main",
    });
  });

  /**
   * TEST_SCENARIO: After a restart, a repository a session edited outside the
   * roots is still listed from the persisted record, with its linked
   * worktrees, and the diff of each is served from the same record rather
   * than refused as unknown.
   */
  it("should diff a session's repository outside the roots after a restart", async () => {
    await fs.mkdir(home, { recursive: true });
    const clone = path.join(elsewhere, "tmp.abc");
    const linked = path.join(elsewhere, "tmp.abc-feat");
    await repository(clone, { "x.md": "x\n" });
    await git(clone, "worktree", "add", "--quiet", "-b", "feat/one", linked);
    await write(path.join(clone, "x.md"), "y\n");
    await write(path.join(linked, "x.md"), "z\n");
    service.onToolActivity({
      sessionId: "s1",
      toolCallId: null,
      started: false,
      editedPaths: [path.join(clone, "x.md")],
      settled: false,
    });
    await expect
      .poll(() => service.repositoriesOf("s1").map((r) => r.path), settles)
      .toEqual([clone]);

    const restarted = serviceFor([path.join(home, "work"), home]);
    const diff = await restarted.diff(clone, "uncommitted");
    const linkedDiff = await serviceFor([path.join(home, "work"), home]).diff(
      linked,
      "uncommitted",
    );

    expect(diff.ok && diff.value.files.map((f) => f.path)).toEqual(["x.md"]);
    expect(linkedDiff.ok && linkedDiff.value.files.map((f) => f.path)).toEqual([
      "x.md",
    ]);
  });

  /**
   * TEST_SCENARIO: A branch with an open pull request carries its link. The
   * session that edited it gets the link once its tool call settles, before
   * anyone opens the panel, so the sessions list can show it.
   */
  it("should link the pull request of a branch", async () => {
    const repo = path.join(home, "work", "app");
    await repository(repo, { "a.txt": "a\n" });
    await git(
      repo,
      "remote",
      "add",
      "origin",
      "https://github.com/acme/app.git",
    );
    await git(repo, "checkout", "--quiet", "-b", "feat/x");
    const link = { number: 7, url: "https://github.com/acme/app/pull/7" };
    const asked: [string | null, string | null][] = [];
    service = serviceFor([home], {
      find: async (remote, branch) => {
        asked.push([remote, branch]);
        return branch === "feat/x" ? link : null;
      },
    });
    service.onToolActivity({
      sessionId: "s1",
      toolCallId: null,
      started: false,
      editedPaths: [path.join(repo, "a.txt")],
      settled: true,
    });
    await expect
      .poll(() => service.repositoriesOf("s1")[0]?.pullRequest, settles)
      .toEqual(link);

    const { changeSets } = await service.list("s1");

    expect(changeSets[0]?.pullRequest).toEqual(link);
    expect(changeSets[0]?.repository.name).toBe("acme/app");
    expect(asked).toContainEqual(["https://github.com/acme/app.git", "feat/x"]);
    expect(service.repositoriesOf("s1")[0]?.pullRequest).toEqual(link);
  });

  /**
   * TEST_SCENARIO: When git cannot read a worktree's status, the change set
   * says so instead of looking clean, and its diff fails instead of coming
   * back empty.
   */
  it("should report a worktree git cannot read rather than call it clean", async () => {
    const repo = path.join(home, "work", "app");
    await repository(repo, { "a.txt": "a\n" });
    const failingStatus: typeof runGit = (cwd, args, opts) =>
      args[0] === "status" || args.includes("--name-status")
        ? Promise.resolve({
            ok: false,
            error: { kind: "failed", message: "index file corrupt" },
          })
        : runGit(cwd, args, opts);
    service = createChangesService({
      roots: [home],
      git: failingStatus,
      touched: createTouchedRepositoryStore(
        createFileDocumentStoreBackend(path.join(tmp, "state")),
      ),
      pullRequests: noPullRequests,
      log: () => undefined,
    });

    const { changeSets } = await service.list();
    const diff = await service.diff(repo, "uncommitted");

    expect(changeSets[0]?.readError).toBe("index file corrupt");
    expect(!diff.ok && diff.error).toEqual({
      kind: "GitFailed",
      message: "index file corrupt",
    });
  });

  /**
   * TEST_SCENARIO: A diff is only served for a change set the service found,
   * so the endpoint cannot be pointed at an arbitrary directory.
   */
  it("should refuse to diff a path that is not a change set", async () => {
    await fs.mkdir(home, { recursive: true });

    const diff = await service.diff(path.join(tmp, "nowhere"), "base");

    expect(diff.ok).toBe(false);
    expect(!diff.ok && diff.error.kind).toBe("NotFound");
  });
});

describe("session pushes", { timeout: 30_000 }, () => {
  const link = { number: 9, url: "https://github.com/acme/app/pull/9" };
  const findsFeature: PullRequestFinder = {
    find: async (_remote, branch) => (branch === "feat/push" ? link : null),
  };

  async function repositoryWithRemote(): Promise<string> {
    const remote = path.join(tmp, "remote.git");
    await fs.mkdir(remote, { recursive: true });
    await git(remote, "init", "--quiet", "--bare");
    const repo = path.join(home, "work", "app");
    await repository(repo, { "a.txt": "a\n" });
    await git(repo, "remote", "add", "origin", remote);
    await git(repo, "push", "--quiet", "origin", "main");
    await git(repo, "checkout", "--quiet", "-b", "feat/push");
    await write(path.join(repo, "a.txt"), "b\n");
    await git(repo, "commit", "--quiet", "-am", "change");
    return repo;
  }

  function toolCall(sessionId: string, toolCallId: string, settled = false) {
    service.onToolActivity({
      sessionId,
      toolCallId,
      editedPaths: [],
      started: !settled,
      settled,
    });
  }

  const watching = () => new Promise((resolve) => setTimeout(resolve, 1_000));

  /**
   * TEST_SCENARIO: A session pushes its branch from a shell command, which
   * names no file. The push links the branch's pull request to that session
   * alone; the push made before the watch started is not anyone's.
   */
  it("should link the pull request a session pushed from a shell command", async () => {
    const repo = await repositoryWithRemote();
    service = serviceFor([home], findsFeature);
    toolCall("s1", "t1");
    await watching();

    await git(repo, "push", "--quiet", "-u", "origin", "feat/push");
    toolCall("s1", "t1", true);

    await expect
      .poll(() => service.repositoriesOf("s1"), settles)
      .toEqual([
        expect.objectContaining({
          path: repo,
          branch: "feat/push",
          pullRequest: link,
        }),
      ]);
    expect(service.repositoriesOf("other")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: Two sessions run tool calls when the push lands. The one
   * that already worked in the repository pushed it; the other gets nothing.
   */
  it("should give a push to the running session that worked in the repository", async () => {
    const repo = await repositoryWithRemote();
    service = serviceFor([home], findsFeature);
    service.onToolActivity({
      sessionId: "s1",
      toolCallId: "t0",
      editedPaths: [path.join(repo, "a.txt")],
      started: true,
      settled: false,
    });
    toolCall("s1", "t0", true);
    toolCall("s1", "t1");
    toolCall("s2", "t2");
    await expect
      .poll(() => service.repositoriesOf("s1").length, settles)
      .toBe(1);
    await watching();

    await git(repo, "push", "--quiet", "origin", "feat/push");

    await expect
      .poll(() => service.repositoriesOf("s1")[0]?.pullRequest, settles)
      .toEqual(link);
    expect(service.repositoriesOf("s2")).toEqual([]);
  });

  async function worktreeOf(repo: string, branch: string): Promise<string> {
    const worktree = path.join(home, "work", "slots", branch.split("/").pop()!);
    await git(repo, "worktree", "add", "--quiet", "-b", branch, worktree);
    await write(path.join(worktree, "b.txt"), "b\n");
    await git(worktree, "add", "-A");
    await git(worktree, "commit", "--quiet", "-m", "change b");
    return worktree;
  }

  function edited(sessionId: string, toolCallId: string, file: string) {
    service.onToolActivity({
      sessionId,
      toolCallId,
      editedPaths: [file],
      started: true,
      settled: false,
    });
    toolCall(sessionId, toolCallId, true);
  }

  /**
   * TEST_SCENARIO: Two sessions run tool calls when a push lands from a
   * worktree only the second one worked in. The push is the second
   * session's, though the first edited another worktree of the repository.
   */
  it("should give a push to the session that worked in the pushed worktree", async () => {
    const repo = await repositoryWithRemote();
    const other = await worktreeOf(repo, "feat/other");
    service = serviceFor([home], findsFeature);
    edited("s1", "t0", path.join(other, "b.txt"));
    edited("s2", "t1", path.join(repo, "a.txt"));
    toolCall("s1", "t2");
    toolCall("s2", "t3");
    await expect
      .poll(() => service.repositoriesOf("s2").length, settles)
      .toBe(1);
    await watching();

    await git(repo, "push", "--quiet", "origin", "feat/push");

    await expect
      .poll(() => service.repositoriesOf("s2")[0]?.pullRequest, settles)
      .toEqual(link);
    expect(
      service.repositoriesOf("s1").map((r) => [r.path, r.branch]),
    ).toEqual([[other, "feat/other"]]);
  });

  /**
   * TEST_SCENARIO: Two sessions run tool calls when a push lands from a
   * worktree neither worked in; the first edited another worktree of the
   * repository. The push is nobody's, and the first session does not list
   * the pushed worktree.
   */
  it("should not give a push to a session that worked in another worktree", async () => {
    const repo = await repositoryWithRemote();
    const other = await worktreeOf(repo, "feat/other");
    const logged: string[] = [];
    service = serviceFor([home], findsFeature, (msg) => logged.push(msg));
    edited("s1", "t0", path.join(other, "b.txt"));
    toolCall("s1", "t1");
    toolCall("s2", "t2");
    await expect
      .poll(() => service.repositoriesOf("s1").length, settles)
      .toBe(1);
    await watching();

    await git(repo, "push", "--quiet", "origin", "feat/push");

    await expect
      .poll(
        () => logged.some((msg) => msg.includes("matches no single session")),
        settles,
      )
      .toBe(true);
    expect(
      service.repositoriesOf("s1").map((r) => [r.path, r.branch]),
    ).toEqual([[other, "feat/other"]]);
    expect(service.repositoriesOf("s2")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: Two sessions run tool calls when the push lands and
   * neither worked in the repository: the push is nobody's rather than a
   * guess, and the log says so.
   */
  it("should link a push no single session ran to nobody", async () => {
    const repo = await repositoryWithRemote();
    const logged: string[] = [];
    service = serviceFor([home], findsFeature, (msg) => logged.push(msg));
    toolCall("s1", "t1");
    toolCall("s2", "t2");
    await watching();

    await git(repo, "push", "--quiet", "origin", "feat/push");

    await expect
      .poll(
        () => logged.some((msg) => msg.includes("matches no single session")),
        settles,
      )
      .toBe(true);
    expect(service.repositoriesOf("s1")).toEqual([]);
    expect(service.repositoriesOf("s2")).toEqual([]);
  });
});
