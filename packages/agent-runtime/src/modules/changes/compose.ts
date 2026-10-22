import type { DocumentStoreBackend } from "../../core/document-store.js";
import { runGit } from "./infrastructure/git.js";
import { createPullRequestFinder } from "./infrastructure/pull-requests.js";
import { createTouchedRepositoryStore } from "./infrastructure/touched-repositories.js";
import {
  createChangesService,
  type ChangesRuntime,
} from "./services/changes-service.js";

export interface ComposeChangesOptions {
  roots: readonly string[];
  stateBackend: DocumentStoreBackend;
  githubToken: () => string;
  sessionOf: (harnessSessionId: string) => string | undefined;
  runningSessions: () => readonly string[];
  log: (msg: string) => void;
}

export function composeChanges(opts: ComposeChangesOptions): ChangesRuntime {
  return createChangesService({
    roots: [...new Set(opts.roots)],
    git: runGit,
    touched: createTouchedRepositoryStore(opts.stateBackend),
    pullRequests: createPullRequestFinder({
      token: opts.githubToken,
      log: opts.log,
    }),
    sessionOf: opts.sessionOf,
    runningSessions: opts.runningSessions,
    log: opts.log,
  });
}
