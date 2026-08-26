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

function makeClient(agentId: string, namespace: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
      }),
    ],
  });
}

export function createAgentFilesClient(namespace: string): AgentFilesClient {
  return {
    async listDirs(agentId, paths) {
      const client = makeClient(agentId, namespace);
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
