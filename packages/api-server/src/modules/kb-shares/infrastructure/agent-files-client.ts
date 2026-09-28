import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter, DirListResult } from "agent-runtime-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

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
      const client = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
          }),
        ],
      });
      try {
        const result = await client.files.listDirs.query({ paths });
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
