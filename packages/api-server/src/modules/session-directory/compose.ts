import type { Db } from "db";

import { SESSION_DIRECTORY_RETENTION_DAYS } from "./domain/types.js";
import { createSessionDirectoryRepository } from "./infrastructure/session-directory-repository.js";
import {
  createSessionDirectoryService,
  type SessionDirectory,
} from "./services/session-directory-service.js";

export function composeSessionDirectory(db: Db): {
  sessionDirectory: SessionDirectory;
  retentionTick: () => Promise<void>;
} {
  const repo = createSessionDirectoryRepository(db);
  return {
    sessionDirectory: createSessionDirectoryService({ repo }),
    retentionTick: async () => {
      const n = await repo.deleteOlderThan(SESSION_DIRECTORY_RETENTION_DAYS);
      if (n > 0) {
        process.stderr.write(
          `[session-directory/retention] deleted ${n} agent_sessions older than ${SESSION_DIRECTORY_RETENTION_DAYS}d\n`,
        );
      }
    },
  };
}
