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
 * files and lines as `git diff <merge-base>`.
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

const noPullRequests: PullRequestFinder = { find: async () => null };

function serviceFor(
  roots: string[],
  pullRequests: PullRequestFinder = noPullRequests,
): ChangesRuntime {
  return createChangesService({
    roots,
    git: runGit,
    touched: createTouchedRepositoryStore(
      createFileDocumentStoreBackend(path.join(tmp, "state")),
    ),
    pullRequests,
    log: () => undefined,
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

describe("changes service", () => {
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
      editedPaths: [path.join(clone, "x.md")],
      settled: false,
    });
    await expect
      .poll(() => service.repositoriesOf("s1").map((r) => r.path))
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
   * TEST_SCENARIO: A branch with an open pull request carries its link, and
   * the session that edited it keeps the link for the sessions list.
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
      editedPaths: [path.join(repo, "a.txt")],
      settled: true,
    });
    await expect.poll(() => service.repositoriesOf("s1").length).toBe(1);

    const { changeSets } = await service.list("s1");

    expect(changeSets[0]?.pullRequest).toEqual(link);
    expect(changeSets[0]?.repository.name).toBe("acme/app");
    expect(asked).toContainEqual(["https://github.com/acme/app.git", "feat/x"]);
    expect(service.repositoriesOf("s1")[0]?.pullRequest).toEqual(link);
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
