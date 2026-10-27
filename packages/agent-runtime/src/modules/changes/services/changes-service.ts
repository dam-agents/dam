import {
  err,
  ok,
  type ChangeSet,
  type ChangesNotice,
  type ChangesService,
  type PullRequestLink,
  type SessionRepository,
} from "agent-runtime-api";

import { noticeStream } from "../../../core/notice-stream.js";
import { createFilesWatcher, type WatchHandle } from "../../files-watch.js";
import { repositoryNameOf } from "../domain/git-output.js";
import { GIT_CONCURRENCY, mapLimit } from "../domain/map-limit.js";
import type { GitCommand } from "../domain/git-trace.js";
import {
  findRepositoryDirs,
  groupWorktrees,
  locateRepository,
} from "../infrastructure/discovery.js";
import type { Git } from "../infrastructure/git.js";
import type { PullRequestFinder } from "../infrastructure/pull-requests.js";
import type { TouchedRepositoryStore } from "../infrastructure/touched-repositories.js";
import {
  defaultBranchRef,
  originUrl,
  readDiff,
  readWorktree,
  type WorktreeState,
} from "../infrastructure/worktree-reader.js";

const SNAPSHOT_REUSE_MS = 1_000;
const NOTICE_INTERVAL_MS = 2_000;
const SESSION_PULL_REQUEST_CHECK_MS = 30_000;
const SHOWN_PULL_REQUESTS_MAX = 100;
const PULL_REQUEST_STATES_PER_QUERY = 50;

interface ChangeSetEntry {
  changeSet: Omit<ChangeSet, "sessionEditedAt">;
  state: WorktreeState;
}

interface Snapshot {
  entries: ChangeSetEntry[];
}

function byRepositoryThenPath(a: ChangeSetEntry, b: ChangeSetEntry): number {
  const name = a.changeSet.repository.name.localeCompare(
    b.changeSet.repository.name,
  );
  return name !== 0 ? name : a.changeSet.path.localeCompare(b.changeSet.path);
}

export interface ChangesRuntime extends ChangesService {
  onGitCommand(command: GitCommand): Promise<void>;
  onToolCallSettled(sessionId: string): void;
  repositoriesOf(sessionId: string): SessionRepository[];
  refreshPullRequests(): void;
  onPullRequestsChanged(listener: () => void): () => void;
}

export function createChangesService(deps: {
  roots: readonly string[];
  git: Git;
  touched: TouchedRepositoryStore;
  pullRequests: PullRequestFinder;
  sessionOf: (harnessSessionId: string) => string | undefined;
  runningSessions: () => readonly string[];
  log: (msg: string) => void;
  now?: () => Date;
}): ChangesRuntime {
  const now = deps.now ?? (() => new Date());
  const workedThisBoot = new Set<string>();
  let snapshot: Promise<Snapshot> | undefined;
  let snapshotAt = 0;

  async function describe(toplevel: string): Promise<{
    name: string;
    branch: string | null;
    remote: string | null;
  }> {
    const [remote, head] = await Promise.all([
      originUrl(deps.git, toplevel),
      deps.git(toplevel, ["symbolic-ref", "-q", "--short", "HEAD"]),
    ]);
    return {
      name: repositoryNameOf(remote, toplevel),
      branch: head.ok && head.value.trim() ? head.value.trim() : null,
      remote,
    };
  }

  const pullRequestsCheckedAt = new Map<string, number>();

  async function linkSessionPullRequests(sessionId: string): Promise<void> {
    const checkedAt = pullRequestsCheckedAt.get(sessionId) ?? 0;
    if (Date.now() - checkedAt < SESSION_PULL_REQUEST_CHECK_MS) return;
    pullRequestsCheckedAt.set(sessionId, Date.now());
    for (const push of deps.touched.pushesOf(sessionId)) {
      const pullRequest = await deps.pullRequests.find(
        push.remote,
        push.branch,
      );
      if (pullRequest)
        deps.touched.linkPullRequest(
          sessionId,
          push.path,
          push.branch,
          pullRequest,
        );
    }
  }

  const pullRequestListeners = new Set<() => void>();
  const shownPullRequests = new Map<string, PullRequestLink>();
  let refreshingStates = false;

  function show(link: PullRequestLink): boolean {
    const known = shownPullRequests.delete(link.url);
    shownPullRequests.set(link.url, link);
    if (shownPullRequests.size > SHOWN_PULL_REQUESTS_MAX)
      shownPullRequests.delete(shownPullRequests.keys().next().value!);
    return !known;
  }

  async function refreshStates(): Promise<void> {
    if (refreshingStates) return;
    refreshingStates = true;
    try {
      const open = [...shownPullRequests.values()].filter(
        ({ state }) => state !== "merged",
      );
      let changed = false;
      for (let i = 0; i < open.length; i += PULL_REQUEST_STATES_PER_QUERY) {
        const fresh = await deps.pullRequests.states(
          open.slice(i, i + PULL_REQUEST_STATES_PER_QUERY),
        );
        for (const link of fresh) {
          shownPullRequests.set(link.url, link);
          if (deps.touched.updatePullRequest(link)) changed = true;
        }
      }
      if (changed) for (const listener of pullRequestListeners) listener();
    } finally {
      refreshingStates = false;
    }
  }

  function refreshPullRequests(): void {
    void refreshStates().catch((error: unknown) =>
      deps.log(
        `refreshing the pull requests' states failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  async function discover(extraPaths: readonly string[]): Promise<Snapshot> {
    const dirs = await findRepositoryDirs(deps.roots);
    const candidates = [...new Set([...dirs, ...extraPaths])];
    const located = await mapLimit(candidates, GIT_CONCURRENCY, (dir) =>
      locateRepository(deps.git, dir),
    );
    const repositories = await groupWorktrees(
      deps.git,
      located.filter((location) => location !== null),
    );
    const perRepository = await mapLimit(
      repositories,
      GIT_CONCURRENCY,
      async ({ commonDir, worktrees }) => {
        const root = worktrees[0]!.path;
        const [defaultRef, remote] = await Promise.all([
          defaultBranchRef(deps.git, root),
          originUrl(deps.git, root),
        ]);
        const defaultBranch = defaultRef?.replace(/^origin\//, "") ?? null;
        const repository = {
          id: commonDir,
          name: repositoryNameOf(remote, root),
          root,
        };
        return mapLimit(worktrees, GIT_CONCURRENCY, async (record) => {
          const state = await readWorktree(deps.git, record, defaultRef);
          const pullRequest =
            state.branch && state.branch !== defaultBranch
              ? await deps.pullRequests.find(remote, state.branch)
              : null;
          if (pullRequest) deps.touched.updatePullRequest(pullRequest);
          return {
            state,
            changeSet: {
              path: state.path,
              repository,
              branch: state.branch,
              baseRef: state.baseRef,
              stat: state.stat,
              commitsAhead: state.commitsAhead,
              uncommitted: state.status.length > 0,
              pullRequest,
              readError: state.readError,
            },
          };
        });
      },
    );
    return { entries: perRepository.flat().sort(byRepositoryThenPath) };
  }

  function current(sessionPaths: readonly string[] = []): Promise<Snapshot> {
    const fresh = snapshot && Date.now() - snapshotAt < SNAPSHOT_REUSE_MS;
    if (fresh) {
      const known = snapshot!.then((s) =>
        sessionPaths.every((path) =>
          s.entries.some((entry) => entry.changeSet.path === path),
        ),
      );
      return known.then((all) => (all ? snapshot! : refresh(sessionPaths)));
    }
    return refresh(sessionPaths);
  }

  function refresh(sessionPaths: readonly string[]): Promise<Snapshot> {
    snapshotAt = Date.now();
    const next = discover([...workedThisBoot, ...sessionPaths]);
    snapshot = next;
    next.catch(() => {
      if (snapshot === next) snapshot = undefined;
    });
    return next;
  }

  const listeners = new Set<() => void>();
  let watches: Map<string, WatchHandle> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastNoticeAt = 0;

  function watchPaths({ entries }: Snapshot): void {
    if (!watches) return;
    for (const { changeSet } of entries) {
      if (watches.has(changeSet.path)) continue;
      const watcher = createFilesWatcher(changeSet.path);
      const gitDir = watcher.watchTree(".git", changed);
      const topLevel = watcher.watchDirs([""], changed);
      watches.set(changeSet.path, {
        close() {
          gitDir.close();
          topLevel.close();
        },
      });
    }
  }

  function emit(): void {
    noticeTimer = undefined;
    lastNoticeAt = Date.now();
    snapshot = undefined;
    for (const listener of listeners) listener();
    if (watches) void current().then(watchPaths, () => undefined);
  }

  function changed(): void {
    if (noticeTimer) return;
    const wait = Math.max(0, lastNoticeAt + NOTICE_INTERVAL_MS - Date.now());
    noticeTimer = setTimeout(emit, wait);
    noticeTimer.unref?.();
  }

  function startWatching(): void {
    watches = new Map();
    for (const root of deps.roots)
      watches.set(
        `root:${root}`,
        createFilesWatcher(root).watchDirs([""], changed),
      );
    void current().then(watchPaths, () => undefined);
  }

  function stopWatching(): void {
    for (const handle of watches?.values() ?? []) handle.close();
    watches = undefined;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = undefined;
  }

  function sessionOfCommand(command: GitCommand): string | undefined {
    if (command.sessionId !== null) return deps.sessionOf(command.sessionId);
    const running = deps.runningSessions();
    return running.length === 1 ? running[0] : undefined;
  }

  async function recordCommand(command: GitCommand): Promise<void> {
    const sessionId = sessionOfCommand(command);
    if (sessionId === undefined) {
      deps.log(
        `a git ${command.name} in ${command.worktree} names no Session of this agent; not linked`,
      );
      return;
    }
    const location = await locateRepository(deps.git, command.worktree);
    if (location === null) return;
    const path = location.toplevel;
    const { name, branch, remote } = await describe(path);
    const push = command.push && command.sessionId !== null;
    const upstream =
      push && branch
        ? await deps.git(path, ["config", "--get", `branch.${branch}.remote`])
        : null;
    const pushRemote =
      upstream?.ok && upstream.value.trim()
        ? await deps.git(path, [
            "config",
            "--get",
            `remote.${upstream.value.trim()}.url`,
          ])
        : null;
    const remoteUrl =
      pushRemote?.ok && pushRemote.value.trim()
        ? pushRemote.value.trim()
        : remote;
    deps.touched.record(sessionId, path, {
      name,
      branch,
      editedAt: now().toISOString(),
      ...(push && { remote: remoteUrl }),
    });
    workedThisBoot.add(path);
    if (push && branch) {
      const pullRequest = await deps.pullRequests.find(remoteUrl, branch);
      if (pullRequest)
        deps.touched.linkPullRequest(sessionId, path, branch, pullRequest);
    }
    changed();
  }

  return {
    async list(sessionId) {
      const editedAt = sessionId
        ? deps.touched.editedAtOf(sessionId)
        : new Map<string, string>();
      const { entries } = await current([...editedAt.keys()]);
      return {
        changeSets: entries.map(({ changeSet }) => ({
          ...changeSet,
          sessionEditedAt: editedAt.get(changeSet.path) ?? null,
        })),
      };
    },

    async diff(path, compare) {
      const find = ({ entries }: Snapshot) =>
        entries.find((candidate) => candidate.changeSet.path === path);
      const entry =
        find(await current()) ?? find(await refresh(deps.touched.paths()));
      if (!entry) return err({ kind: "NotFound", path });
      try {
        const diff = await readDiff(deps.git, entry.state, compare);
        return ok({ path, compare, ...diff });
      } catch (error) {
        return err({
          kind: "GitFailed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },

    watch(signal): AsyncIterable<ChangesNotice> {
      return noticeStream<ChangesNotice>(
        { topic: "changes" },
        (onChange) => {
          listeners.add(onChange);
          if (listeners.size === 1) startWatching();
          return {
            close() {
              listeners.delete(onChange);
              if (listeners.size === 0) stopWatching();
            },
          };
        },
        signal,
      );
    },

    onGitCommand(command) {
      return recordCommand(command).catch((error: unknown) =>
        deps.log(
          `recording a git ${command.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    },

    onToolCallSettled(sessionId) {
      changed();
      void linkSessionPullRequests(sessionId).catch((error: unknown) =>
        deps.log(
          `linking the session's pull requests failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    },

    repositoriesOf(sessionId) {
      const repositories = deps.touched.repositoriesOf(sessionId);
      let unseen = false;
      for (const { pullRequest } of repositories)
        if (pullRequest && show(pullRequest) && !pullRequest.state)
          unseen = true;
      if (unseen) refreshPullRequests();
      return repositories;
    },

    refreshPullRequests,

    onPullRequestsChanged(listener) {
      pullRequestListeners.add(listener);
      return () => pullRequestListeners.delete(listener);
    },
  };
}
