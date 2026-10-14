import {
  err,
  ok,
  type ChangeSet,
  type ChangesNotice,
  type ChangesService,
  type SessionRepository,
} from "agent-runtime-api";

import { noticeStream } from "../../../core/notice-stream.js";
import { createFilesWatcher, type WatchHandle } from "../../files-watch.js";
import { repositoryNameOf } from "../domain/git-output.js";
import { GIT_CONCURRENCY, mapLimit } from "../domain/map-limit.js";
import type { ToolActivity } from "../domain/tool-activity.js";
import {
  findRepositoryDirs,
  groupWorktrees,
  locateFile,
  locateRepository,
  type RepositoryLocation,
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
  onToolActivity(activity: ToolActivity): void;
  repositoriesOf(sessionId: string): SessionRepository[];
}

export function createChangesService(deps: {
  roots: readonly string[];
  git: Git;
  touched: TouchedRepositoryStore;
  pullRequests: PullRequestFinder;
  log: (msg: string) => void;
  now?: () => Date;
}): ChangesRuntime {
  const now = deps.now ?? (() => new Date());
  const editedThisBoot = new Set<string>();
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
    for (const touched of deps.touched.repositoriesOf(sessionId)) {
      if (touched.branch === null) continue;
      const { branch, remote } = await describe(touched.path);
      if (branch !== touched.branch) continue;
      const pullRequest = await deps.pullRequests.find(remote, branch);
      if (pullRequest)
        deps.touched.linkPullRequest(touched.path, branch, pullRequest);
    }
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
          if (pullRequest)
            deps.touched.linkPullRequest(state.path, state.branch, pullRequest);
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

  function current(sessionId?: string): Promise<Snapshot> {
    const sessionPaths = sessionId
      ? [...deps.touched.editedAtOf(sessionId).keys()]
      : [];
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
    const next = discover([...editedThisBoot, ...sessionPaths]);
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

  async function recordEdits(activity: ToolActivity): Promise<void> {
    const editedAt = now().toISOString();
    const locations = await mapLimit(
      activity.editedPaths,
      GIT_CONCURRENCY,
      (path) => locateFile(deps.git, path),
    );
    const toplevels = new Map<string, RepositoryLocation>();
    for (const location of locations)
      if (location) toplevels.set(location.toplevel, location);
    for (const location of toplevels.values()) {
      const { name, branch } = await describe(location.toplevel);
      deps.touched.record(activity.sessionId, location.toplevel, {
        name,
        branch,
        editedAt,
      });
      editedThisBoot.add(location.toplevel);
    }
  }

  return {
    async list(sessionId) {
      const { entries } = await current(sessionId);
      const editedAt = sessionId
        ? deps.touched.editedAtOf(sessionId)
        : new Map<string, string>();
      return {
        changeSets: entries.map(({ changeSet }) => ({
          ...changeSet,
          sessionEditedAt: editedAt.get(changeSet.path) ?? null,
        })),
      };
    },

    async diff(path, compare) {
      const { entries } = await current();
      const entry = entries.find(
        (candidate) => candidate.changeSet.path === path,
      );
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

    onToolActivity(activity) {
      const recorded =
        activity.editedPaths.length > 0
          ? recordEdits(activity).catch((error: unknown) =>
              deps.log(
                `recording edited repositories failed: ${error instanceof Error ? error.message : String(error)}`,
              ),
            )
          : Promise.resolve();
      if (activity.settled || activity.editedPaths.length > 0)
        void recorded.then(changed);
      if (activity.settled)
        void recorded
          .then(() => linkSessionPullRequests(activity.sessionId))
          .catch((error: unknown) =>
            deps.log(
              `linking the session's pull requests failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
    },

    repositoriesOf(sessionId) {
      return deps.touched.repositoriesOf(sessionId);
    },
  };
}
