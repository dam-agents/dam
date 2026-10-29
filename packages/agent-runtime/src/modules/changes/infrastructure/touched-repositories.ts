import { z } from "zod";
import {
  pullRequestLinkSchema,
  type PullRequestLink,
  type SessionRepository,
} from "agent-runtime-api";

import type { DocumentStoreBackend } from "../../../core/document-store.js";

export const MAX_TOUCHED_PER_SESSION = 20;
export const MAX_TOUCHED_SESSIONS = 1000;

const touchedSchema = z.object({
  name: z.string(),
  branch: z.string().nullable(),
  editedAt: z.string(),
  pullRequest: pullRequestLinkSchema.nullable(),
  remote: z.string().nullable().optional(),
});

const documentSchema = z.object({
  sessions: z.record(z.string(), z.record(z.string(), touchedSchema)).catch({}),
});

type Touched = z.infer<typeof touchedSchema>;
type TouchedBySession = Record<string, Record<string, Touched>>;

export interface TouchedRepositoryStore {
  record(
    sessionId: string,
    path: string,
    touched: {
      name: string;
      branch: string | null;
      editedAt: string;
      remote?: string | null;
    },
  ): void;
  linkPullRequest(
    sessionId: string,
    path: string,
    branch: string,
    pullRequest: PullRequestLink,
  ): boolean;
  updatePullRequest(pullRequest: PullRequestLink): boolean;
  editedAtOf(sessionId: string): Map<string, string>;
  paths(): string[];
  repositoriesOf(sessionId: string): SessionRepository[];
  pushesOf(sessionId: string): SessionPush[];
}

export interface SessionPush {
  path: string;
  branch: string;
  remote: string;
}

function latest(entries: Record<string, Touched>): string {
  return Object.values(entries).reduce(
    (max, entry) => (entry.editedAt > max ? entry.editedAt : max),
    "",
  );
}

function bounded(sessions: TouchedBySession): TouchedBySession {
  const ids = Object.keys(sessions);
  if (ids.length <= MAX_TOUCHED_SESSIONS) return sessions;
  const kept = ids
    .sort((a, b) => (latest(sessions[b]!) < latest(sessions[a]!) ? -1 : 1))
    .slice(0, MAX_TOUCHED_SESSIONS);
  return Object.fromEntries(kept.map((id) => [id, sessions[id]!]));
}

function sameLink(a: PullRequestLink | null, b: PullRequestLink): boolean {
  return (
    a !== null &&
    a.url === b.url &&
    a.number === b.number &&
    a.state === b.state &&
    a.conflicts === b.conflicts
  );
}

function newestFirst(entries: Record<string, Touched>): [string, Touched][] {
  return Object.entries(entries).sort(([, a], [, b]) =>
    a.editedAt < b.editedAt ? 1 : a.editedAt > b.editedAt ? -1 : 0,
  );
}

export function createTouchedRepositoryStore(
  backend: DocumentStoreBackend,
): TouchedRepositoryStore {
  const store = backend.open("touched-repositories", {
    schema: documentSchema,
    initial: () => ({ sessions: {} }),
  });

  return {
    record(sessionId, path, touched) {
      const { sessions } = store.read();
      const current = sessions[sessionId] ?? {};
      const previous = current[path];
      const sameBranch = previous && previous.branch === touched.branch;
      const next = {
        ...current,
        [path]: {
          ...touched,
          pullRequest: sameBranch ? previous.pullRequest : null,
          remote: touched.remote ?? (sameBranch ? previous.remote : null),
        },
      };
      const kept = Object.fromEntries(
        newestFirst(next).slice(0, MAX_TOUCHED_PER_SESSION),
      );
      store.write({ sessions: bounded({ ...sessions, [sessionId]: kept }) });
    },

    linkPullRequest(sessionId, path, branch, pullRequest) {
      const { sessions } = store.read();
      const entries = sessions[sessionId];
      const entry = entries?.[path];
      if (
        !entry ||
        entry.branch !== branch ||
        sameLink(entry.pullRequest, pullRequest)
      )
        return false;
      store.write({
        sessions: {
          ...sessions,
          [sessionId]: { ...entries, [path]: { ...entry, pullRequest } },
        },
      });
      return true;
    },

    updatePullRequest(pullRequest) {
      const { sessions } = store.read();
      let changed = false;
      const next: TouchedBySession = {};
      for (const [sessionId, entries] of Object.entries(sessions)) {
        next[sessionId] = Object.fromEntries(
          Object.entries(entries).map(([path, entry]) => {
            const stale =
              entry.pullRequest?.url === pullRequest.url &&
              !sameLink(entry.pullRequest, pullRequest);
            if (stale) changed = true;
            return [path, stale ? { ...entry, pullRequest } : entry];
          }),
        );
      }
      if (changed) store.write({ sessions: next });
      return changed;
    },

    editedAtOf(sessionId) {
      const entries = store.read().sessions[sessionId] ?? {};
      return new Map(
        Object.entries(entries).map(([path, entry]) => [path, entry.editedAt]),
      );
    },

    paths() {
      return [
        ...new Set(
          Object.values(store.read().sessions).flatMap((entries) =>
            Object.keys(entries),
          ),
        ),
      ];
    },

    pushesOf(sessionId) {
      const entries = store.read().sessions[sessionId] ?? {};
      return Object.entries(entries).flatMap(([path, entry]) =>
        entry.remote && entry.branch
          ? [{ path, branch: entry.branch, remote: entry.remote }]
          : [],
      );
    },

    repositoriesOf(sessionId) {
      const entries = store.read().sessions[sessionId] ?? {};
      return newestFirst(entries).map(([path, entry]) => ({
        name: entry.name,
        path,
        branch: entry.branch,
        pullRequest: entry.pullRequest,
      }));
    },
  };
}
