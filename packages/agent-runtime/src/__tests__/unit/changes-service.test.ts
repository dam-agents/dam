import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { runOnce } from "../../core/run-once.js";
import { runGit } from "../../modules/changes/infrastructure/git.js";
import type { PullRequestFinder } from "../../modules/changes/infrastructure/pull-requests.js";
import { createTouchedRepositoryStore } from "../../modules/changes/infrastructure/touched-repositories.js";
import {
  createChangesService,
  type ChangesRuntime,
} from "../../modules/changes/services/changes-service.js";
import {
  gitCommandOf,
  gitTraceEnv,
  sessionEnvVarsOf,
} from "../../modules/changes/domain/git-trace.js";

const sessionEnvVars = sessionEnvVarsOf([
  "CLAUDE_CODE_SESSION_ID",
  "CODEX_THREAD_ID",
  "PI_SESSION_ID",
]);

/**
 * TEST_OVERVIEW: the changes service finds every git repository the agent
 * has and reads each worktree as a change set, against real repositories on
 * disk. $HOME may itself be a repository with others nested inside it, a
 * repository may have several worktrees, and a session may work in a
 * repository outside $HOME (a clone in /tmp), linked by the commits it makes. The diff against base must give the same
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

const noPullRequests: PullRequestFinder = {
  find: async () => null,
  states: async () => [],
};

let running: string[] = [];

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
    sessionOf: (id) => (id.startsWith("harness-") ? id.slice(8) : id),
    runningSessions: () => running,
    log,
    now: () => new Date("2026-10-14T10:00:00.000Z"),
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: runs git with its trace written into a directory, as agent-runtime
 * configures it for its harnesses, then hands every finished trace to the
 * service the way the trace reader does. The Session variables of the shell
 * running the tests are dropped, so only the ones a spec sets are recorded.
 */
async function traced(
  sessionEnv: Record<string, string>,
  cwd: string,
  ...args: string[]
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(tmp, "trace-"));
  const result = await runOnce({
    command: [
      "git",
      "-c",
      "user.email=bench@example.com",
      "-c",
      "user.name=Bench",
      "-C",
      cwd,
      ...args,
    ],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !sessionEnvVars.includes(key),
        ),
      ),
      ...gitTraceEnv(dir, sessionEnvVars),
      ...sessionEnv,
    },
    timeoutMs: 30_000,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  for (const name of await fs.readdir(dir)) {
    const command = gitCommandOf(
      await fs.readFile(path.join(dir, name), "utf8"),
      sessionEnvVars,
    );
    if (command) await service.onGitCommand(command);
  }
}

beforeEach(async () => {
  tmp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "changes-service-")),
  );
  home = path.join(tmp, "home");
  elsewhere = path.join(tmp, "elsewhere");
  running = [];
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
   * TEST_SCENARIO: A session commits in a repository outside the scanned
   * roots (a clone in /tmp), however it wrote the files. The commit adds that
   * repository to the list, marked with when the session worked in it, and
   * records it for the sessions list.
   */
  it("should add a repository a session committed in outside the roots", async () => {
    await repository(path.join(home, "work", "app"), { "a.txt": "a\n" });
    const clone = path.join(elsewhere, "tmp.abc");
    await repository(clone, { "x.md": "x\n" });
    await write(path.join(clone, "x.md"), "y\n");

    await traced(
      { CLAUDE_CODE_SESSION_ID: "s1" },
      clone,
      "commit",
      "--quiet",
      "-am",
      "y",
    );
    const { changeSets } = await service.list("s1");

    expect(service.repositoriesOf("s1").map((r) => r.path)).toEqual([clone]);
    expect(changeSets.find((c) => c.path === clone)?.sessionEditedAt).toBe(
      "2026-10-14T10:00:00.000Z",
    );
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
   * TEST_SCENARIO: Each harness names its Session in a variable of its own,
   * and the platform's own variable wins over a harness's. Every one links
   * the commit to the Session agent-runtime maps it to.
   */
  it("should link a commit to the Session each harness names", async () => {
    const repo = path.join(home, "work", "app");
    await repository(repo, { "a.txt": "a\n" });
    const commit = (env: Record<string, string>) =>
      traced(env, repo, "commit", "--quiet", "--allow-empty", "-m", "x");

    await commit({ CODEX_THREAD_ID: "harness-codex" });
    await commit({ PI_SESSION_ID: "harness-pi" });
    await commit({ HARNESS_SESSION_ID: "term", CLAUDE_CODE_SESSION_ID: "cc" });

    expect(service.repositoriesOf("codex").map((r) => r.path)).toEqual([repo]);
    expect(service.repositoriesOf("pi").map((r) => r.path)).toEqual([repo]);
    expect(service.repositoriesOf("term").map((r) => r.path)).toEqual([repo]);
    expect(service.repositoriesOf("cc")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: Only commands that record work on a branch link a
   * Session. Reading the repository, switching branches or a command that
   * failed links nothing.
   */
  it("should not link a Session for a command that records no work", async () => {
    const repo = path.join(home, "work", "app");
    await repository(repo, { "a.txt": "a\n" });
    const env = { CLAUDE_CODE_SESSION_ID: "s1" };

    await traced(env, repo, "status");
    await traced(env, repo, "log", "--oneline");
    await traced(env, repo, "checkout", "--quiet", "-b", "feat/x");
    await traced(env, repo, "commit", "--quiet", "-m", "nothing").catch(
      () => undefined,
    );

    expect(service.repositoriesOf("s1")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A commit that names no Session goes to the one Session
   * running a turn, the way a harness that sets no variable is still served;
   * with two running it is nobody's, logged rather than guessed.
   */
  it("should give a commit that names no Session to the only one running", async () => {
    const repo = path.join(home, "work", "app");
    await repository(repo, { "a.txt": "a\n" });
    const logged: string[] = [];
    service = serviceFor([home], noPullRequests, (msg) => logged.push(msg));
    const commit = () =>
      traced({}, repo, "commit", "--quiet", "--allow-empty", "-m", "x");

    running = ["bob"];
    await commit();
    running = ["bob", "other"];
    await commit();

    expect(service.repositoriesOf("bob").map((r) => r.path)).toEqual([repo]);
    expect(service.repositoriesOf("other")).toEqual([]);
    expect(logged.some((msg) => msg.includes("names no Session"))).toBe(true);
  });

  /**
   * TEST_SCENARIO: After a restart, a repository a session committed in
   * outside the roots is still listed from the persisted record, with its
   * linked worktrees, and the diff of each is served from the same record
   * rather than refused as unknown.
   */
  it("should diff a session's repository outside the roots after a restart", async () => {
    await fs.mkdir(home, { recursive: true });
    const clone = path.join(elsewhere, "tmp.abc");
    const linked = path.join(elsewhere, "tmp.abc-feat");
    await repository(clone, { "x.md": "x\n" });
    await git(clone, "worktree", "add", "--quiet", "-b", "feat/one", linked);
    await traced(
      { CLAUDE_CODE_SESSION_ID: "s1" },
      clone,
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "x",
    );
    await write(path.join(clone, "x.md"), "y\n");
    await write(path.join(linked, "x.md"), "z\n");

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
   * TEST_SCENARIO: A branch with an open pull request carries its link in
   * the panel. A session that only committed on it does not get the link,
   * not when its tool calls settle and not when the panel finds it: a
   * session's pull request is one it pushed.
   */
  it("should not link the pull request of a branch a session only committed on", async () => {
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
    service = serviceFor([home], {
      find: async (_remote, branch) => (branch === "feat/x" ? link : null),
      states: async () => [],
    });
    await traced(
      { CLAUDE_CODE_SESSION_ID: "s1" },
      repo,
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "x",
    );

    service.onToolCallSettled("s1");
    const { changeSets } = await service.list("s1");

    expect(changeSets[0]?.pullRequest).toEqual(link);
    expect(changeSets[0]?.repository.name).toBe("acme/app");
    expect(service.repositoriesOf("s1")).toEqual([
      expect.objectContaining({ path: repo, pullRequest: null }),
    ]);
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
      sessionOf: (id) => id,
      runningSessions: () => [],
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
    states: async () => [],
  };

  async function repositoryWithRemote(): Promise<{
    repo: string;
    remote: string;
  }> {
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
    return { repo, remote };
  }

  /**
   * TEST_SCENARIO: A session pushes its branch from a shell command while
   * another session runs too. The push names its Session, so it links the
   * branch's pull request to that session alone, on the remote it went to.
   */
  it("should link the pull request a session pushed", async () => {
    const { repo, remote } = await repositoryWithRemote();
    const asked: [string | null, string | null][] = [];
    service = serviceFor([home], {
      find: async (remoteUrl, branch) => {
        asked.push([remoteUrl, branch]);
        return findsFeature.find(remoteUrl, branch);
      },
      states: async () => [],
    });
    running = ["s1", "s2"];

    await traced(
      { CLAUDE_CODE_SESSION_ID: "s1" },
      repo,
      "push",
      "--quiet",
      "-u",
      "origin",
      "feat/push",
    );

    expect(service.repositoriesOf("s1")).toEqual([
      expect.objectContaining({
        path: repo,
        branch: "feat/push",
        pullRequest: link,
      }),
    ]);
    expect(service.repositoriesOf("s2")).toEqual([]);
    expect(asked).toContainEqual([remote, "feat/push"]);
  });

  /**
   * TEST_SCENARIO: A session pulls in a repository it does nothing else in,
   * by a merge and by a rebase, as the tools an agent runs pull their caches.
   * The pull and the merge or rebase it starts link no repository.
   */
  it("should not link a repository a session only pulled in", async () => {
    const { repo, remote } = await repositoryWithRemote();
    const clone = path.join(home, "work", "cache");
    await git(tmp, "clone", "--quiet", "--branch", "main", remote, clone);
    await git(repo, "push", "--quiet", "origin", "feat/push:main");
    const env = { CLAUDE_CODE_SESSION_ID: "s1" };

    await traced(env, clone, "pull", "--quiet", "--no-rebase");
    await git(repo, "commit", "--quiet", "--allow-empty", "-m", "more");
    await git(repo, "push", "--quiet", "origin", "feat/push:main");
    await git(clone, "commit", "--quiet", "--allow-empty", "-m", "local");
    await traced(env, clone, "pull", "--quiet", "--rebase");

    expect(
      (await git(clone, "log", "--format=%s", "-3")).trim().split("\n"),
    ).toEqual(["local", "more", "change"]);
    expect(service.repositoriesOf("s1")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A session pushes a branch with an open pull request from
   * a clone outside the scanned roots, as an agent working in /tmp does. The
   * push links that clone and its pull request to the session.
   */
  it("should link the pull request a session pushed from outside the roots", async () => {
    const { repo, remote } = await repositoryWithRemote();
    const clone = path.join(elsewhere, "tmp.xyz");
    await fs.mkdir(elsewhere, { recursive: true });
    await git(repo, "push", "--quiet", "origin", "feat/push");
    await git(tmp, "clone", "--quiet", "--branch", "feat/push", remote, clone);
    await git(clone, "commit", "--quiet", "--allow-empty", "-m", "more");
    service = serviceFor([path.join(home, "work"), home], findsFeature);

    await traced(
      { CLAUDE_CODE_SESSION_ID: "s1" },
      clone,
      "push",
      "--quiet",
      "origin",
      "feat/push",
    );

    expect(service.repositoriesOf("s1")).toEqual([
      expect.objectContaining({
        path: clone,
        branch: "feat/push",
        pullRequest: link,
      }),
    ]);
  });

  /**
   * TEST_SCENARIO: Two sessions work in two worktrees of one repository.
   * Each push goes to the session that ran it, in the worktree it ran in.
   */
  it("should give each push to the session and worktree that ran it", async () => {
    const { repo } = await repositoryWithRemote();
    const other = path.join(home, "work", "slots", "other");
    await git(repo, "worktree", "add", "--quiet", "-b", "feat/other", other);
    await write(path.join(other, "b.txt"), "b\n");
    await git(other, "add", "-A");
    await git(other, "commit", "--quiet", "-m", "change b");
    service = serviceFor([home], findsFeature);
    running = ["s1", "s2"];

    await traced(
      { CLAUDE_CODE_SESSION_ID: "s1" },
      other,
      "push",
      "--quiet",
      "origin",
      "feat/other",
    );
    await traced(
      { CLAUDE_CODE_SESSION_ID: "s2" },
      repo,
      "push",
      "--quiet",
      "origin",
      "feat/push",
    );

    expect(service.repositoriesOf("s1").map((r) => [r.path, r.branch])).toEqual(
      [[other, "feat/other"]],
    );
    expect(service.repositoriesOf("s2")).toEqual([
      expect.objectContaining({
        path: repo,
        branch: "feat/push",
        pullRequest: link,
      }),
    ]);
  });

  /**
   * TEST_SCENARIO: Session A commits on a branch in a clone, and session B
   * pushes the same branch from that clone. The pull request is B's: only B
   * gets the link, also once A's tool calls settle.
   */
  it("should link a pushed pull request only to the session that pushed it", async () => {
    const { repo } = await repositoryWithRemote();
    service = serviceFor([home], findsFeature);
    running = ["a", "b"];

    await traced(
      { CLAUDE_CODE_SESSION_ID: "a" },
      repo,
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "a's commit",
    );
    await traced(
      { CLAUDE_CODE_SESSION_ID: "b" },
      repo,
      "push",
      "--quiet",
      "-u",
      "origin",
      "feat/push",
    );
    service.onToolCallSettled("a");
    service.onToolCallSettled("b");
    await service.list("a");

    expect(service.repositoriesOf("a")).toEqual([
      expect.objectContaining({ path: repo, pullRequest: null }),
    ]);
    expect(service.repositoriesOf("b")).toEqual([
      expect.objectContaining({ path: repo, pullRequest: link }),
    ]);
  });

  /**
   * TEST_SCENARIO: One session pushes one branch from two clones of a
   * repository, as an agent with work slots does. Each clone carries the
   * same pull request, which the sessions list shows once.
   */
  it("should link one pull request to both clones a session pushed from", async () => {
    const { repo, remote } = await repositoryWithRemote();
    await git(repo, "push", "--quiet", "origin", "feat/push");
    const clone = path.join(home, "work", "slots", "3");
    await git(tmp, "clone", "--quiet", "--branch", "feat/push", remote, clone);
    await git(clone, "commit", "--quiet", "--allow-empty", "-m", "more");
    service = serviceFor([home], findsFeature);
    const env = { CLAUDE_CODE_SESSION_ID: "s1" };

    await traced(env, clone, "push", "--quiet", "origin", "feat/push");
    await git(repo, "pull", "--quiet", "--no-rebase", "origin", "feat/push");
    await traced(env, repo, "push", "--quiet", "origin", "feat/push");

    expect(
      service.repositoriesOf("s1").map((r) => [r.path, r.pullRequest]),
    ).toEqual(
      expect.arrayContaining([
        [repo, link],
        [clone, link],
      ]),
    );
    expect(service.repositoriesOf("s1")).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: A session pushes its branch, a tool call settles before
   * the pull request exists, and the session opens it in the next tool call,
   * inside the lookup's 30 s window. The skipped lookup runs once the window
   * ends, links the pull request and tells the list to read again.
   */
  it("should link a pull request opened inside the lookup window", async () => {
    const { repo } = await repositoryWithRemote();
    let opened = false;
    service = serviceFor([home], {
      find: async (remote, branch) =>
        opened ? findsFeature.find(remote, branch) : null,
      states: async () => [],
    });
    const env = { CLAUDE_CODE_SESSION_ID: "s1" };
    await traced(env, repo, "push", "--quiet", "-u", "origin", "feat/push");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      let announced = false;
      service.onPullRequestsChanged(() => (announced = true));
      service.onToolCallSettled("s1");
      await vi.advanceTimersByTimeAsync(5_000);
      opened = true;
      service.onToolCallSettled("s1");
      await vi.advanceTimersByTimeAsync(1_000);

      expect(service.repositoriesOf("s1")).toEqual([
        expect.objectContaining({ path: repo, pullRequest: null }),
      ]);

      await vi.advanceTimersByTimeAsync(30_000);

      expect(announced).toBe(true);
      expect(service.repositoriesOf("s1")).toEqual([
        expect.objectContaining({ path: repo, pullRequest: link }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * TEST_SCENARIO: A push that names no Session goes to the one Session
   * running a turn as work, but links no pull request to it: someone else
   * may have run it.
   */
  it("should not link a pull request from a push that names no Session", async () => {
    const { repo } = await repositoryWithRemote();
    service = serviceFor([home], findsFeature);
    running = ["bob"];

    await traced({}, repo, "push", "--quiet", "-u", "origin", "feat/push");
    service.onToolCallSettled("bob");
    await service.list("bob");

    expect(service.repositoriesOf("bob")).toEqual([
      expect.objectContaining({ path: repo, pullRequest: null }),
    ]);
  });
});

describe("pull request states", { timeout: 30_000 }, () => {
  /**
   * TEST_SCENARIO: A session's pull request waits for review, and a reviewer
   * approves it. The sessions list reads the session's repositories; the
   * next refresh reads the new state, stores it on the record and tells the
   * list to read again, so the badge turns green without a new push.
   */
  it("should refresh the state of a pull request the list shows", async () => {
    const remote = path.join(tmp, "remote.git");
    await fs.mkdir(remote, { recursive: true });
    await git(remote, "init", "--quiet", "--bare");
    const repo = path.join(home, "work", "app");
    await repository(repo, { "a.txt": "a\n" });
    await git(repo, "remote", "add", "origin", remote);
    await git(repo, "checkout", "--quiet", "-b", "feat/x");
    const url = "https://github.com/acme/app/pull/7";
    let state: "pending" | "approved" = "pending";
    const asked: string[][] = [];
    service = serviceFor([home], {
      find: async (_remote, branch) =>
        branch === "feat/x"
          ? { number: 7, url, state: "pending", conflicts: false }
          : null,
      states: async (links) => {
        asked.push(links.map((link) => link.url));
        return links.map((link) => ({ ...link, state, conflicts: false }));
      },
    });
    let notices = 0;
    service.onPullRequestsChanged(() => notices++);
    await traced(
      { CLAUDE_CODE_SESSION_ID: "s1" },
      repo,
      "push",
      "--quiet",
      "-u",
      "origin",
      "feat/x",
    );
    await expect
      .poll(() => service.repositoriesOf("s1")[0]?.pullRequest?.state, settles)
      .toBe("pending");

    state = "approved";
    service.refreshPullRequests();

    await expect
      .poll(() => service.repositoriesOf("s1")[0]?.pullRequest?.state, settles)
      .toBe("approved");
    expect(notices).toBe(1);
    expect(asked.at(-1)).toEqual([url]);
  });
});
