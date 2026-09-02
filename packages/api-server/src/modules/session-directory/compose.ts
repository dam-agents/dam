import type { Db } from "db";

import { withAdvisoryLock } from "../../core/advisory-lock.js";
import { createSessionDirectoryRepository } from "./infrastructure/session-directory-repository.js";
import {
  startSessionDirectoryRetentionJob,
  type SessionDirectoryRetentionJob,
} from "./sagas/session-directory-retention-job.js";
import {
  createSessionDirectoryService,
  type SessionDirectory,
} from "./services/session-directory-service.js";

export function composeSessionDirectory(db: Db): {
  sessionDirectory: SessionDirectory;
  retentionJob: SessionDirectoryRetentionJob;
} {
  const repo = createSessionDirectoryRepository(db);
  return {
    sessionDirectory: createSessionDirectoryService({ repo }),
    retentionJob: startSessionDirectoryRetentionJob({
      withLock: withAdvisoryLock(db),
      deleteOld: (days) => repo.deleteOlderThan(days),
    }),
  };
}
