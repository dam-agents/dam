import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter, DirListResult } from "agent-runtime-api";
import type { SandboxAddresses } from "../../agents/infrastructure/sandbox-addresses.js";

export class AgentFilesUnreachableError extends Error {
  constructor(agentId: string, cause: string) {
    super(`agent ${agentId} files api unreachable: ${cause}`);
    this.name = "AgentFilesUnreachableError";
  }
}

export interface AgentFilesClient {
  listDirs(agentId: string, paths: string[]): Promise<DirListResult[]>;
}

function makeClient(agentId: string, addresses: SandboxAddresses) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${addresses.baseUrl(agentId)}/api/trpc`,
      }),
    ],
  });
}

export function createAgentFilesClient(addresses: SandboxAddresses): AgentFilesClient {
  return {
    async listDirs(agentId, paths) {
      const client = makeClient(agentId, addresses);
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
