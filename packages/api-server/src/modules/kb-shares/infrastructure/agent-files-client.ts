import type { DirListResult } from "agent-runtime-api";
import { agentServiceClient } from "../../../core/agent-service-client.js";

export class AgentFilesUnreachableError extends Error {
  constructor(agentId: string, cause: string) {
    super(`agent ${agentId} files api unreachable: ${cause}`);
    this.name = "AgentFilesUnreachableError";
  }
}

export interface AgentFilesClient {
  listDirs(agentId: string, paths: string[]): Promise<DirListResult[]>;
}

export function createAgentFilesClient(namespace: string): AgentFilesClient {
  return {
    async listDirs(agentId, paths) {
      try {
        const result = await agentServiceClient(
          agentId,
          namespace,
        ).files.listDirs.query({ paths });
        return result.results;
      } catch (err) {
        throw new AgentFilesUnreachableError(
          agentId,
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}
