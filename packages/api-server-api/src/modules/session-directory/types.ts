import type { SessionDirectoryEntry } from "agent-runtime-api";

export interface SessionDirectoryService {
  record(
    agentId: string,
    sessions: readonly SessionDirectoryEntry[],
  ): Promise<void>;
}
