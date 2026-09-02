import type { Db } from "db";

import { createSessionDirectoryRepository } from "./infrastructure/session-directory-repository.js";
import {
  createSessionDirectoryService,
  type SessionDirectory,
} from "./services/session-directory-service.js";

export function composeSessionDirectory(db: Db): SessionDirectory {
  return createSessionDirectoryService({
    repo: createSessionDirectoryRepository(db),
  });
}
