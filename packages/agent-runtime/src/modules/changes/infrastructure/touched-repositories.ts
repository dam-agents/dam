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
    touched: { name: string; branch: string | null; editedAt: string },
  ): void;
  linkPullRequest(
    path: string,
    branch: string | null,
    pullRequest: PullRequestLink,
  ): void;
  editedAtOf(sessionId: string): Map<string, string>;
  paths(): string[];
  repositoriesOf(sessionId: string): SessionRepository[];
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
      const next = {
        ...current,
        [path]: {
          ...touched,
          pullRequest:
            previous && previous.branch === touched.branch
              ? previous.pullRequest
              : null,
        },
      };
      const kept = Object.fromEntries(
        newestFirst(next).slice(0, MAX_TOUCHED_PER_SESSION),
      );
      store.write({ sessions: bounded({ ...sessions, [sessionId]: kept }) });
    },

    linkPullRequest(path, branch, pullRequest) {
      const { sessions } = store.read();
      let changed = false;
      const next: TouchedBySession = {};
      for (const [sessionId, entries] of Object.entries(sessions)) {
        const entry = entries[path];
        const stale =
          entry !== undefined &&
          entry.branch === branch &&
          entry.pullRequest?.url !== pullRequest.url;
        if (stale) changed = true;
        next[sessionId] = stale
          ? { ...entries, [path]: { ...entry, pullRequest } }
          : entries;
      }
      if (changed) store.write({ sessions: next });
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
