import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type {
  AppRouter,
  DirListResult,
  FileReadResult,
} from "agent-runtime-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

export class AgentFileTooLargeError extends Error {
  constructor(public readonly path: string) {
    super(`file exceeds the agent-runtime read cap: ${path}`);
    this.name = "AgentFileTooLargeError";
  }
}

export class AgentFileNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`file not found: ${path}`);
    this.name = "AgentFileNotFoundError";
  }
}

export class AgentFilesUnreachableError extends Error {
  constructor(agentId: string, cause: string) {
    super(`agent ${agentId} files api unreachable: ${cause}`);
    this.name = "AgentFilesUnreachableError";
  }
}

export interface AgentFilesClient {
  listDirs(agentId: string, paths: string[]): Promise<DirListResult[]>;
  read(agentId: string, path: string): Promise<FileReadResult>;
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
        throw toClientError(agentId, "", err);
      }
    },

    async read(agentId, path) {
      const client = makeClient(agentId, namespace);
      try {
        return await client.files.read.query({ path });
      } catch (err) {
        throw toClientError(agentId, path, err);
      }
    },
  };
}

function toClientError(agentId: string, path: string, err: unknown): Error {
  if (err instanceof TRPCClientError) {
    if (err.data?.code === "NOT_FOUND") {
      return new AgentFileNotFoundError(path);
    }
    if (err.data?.code === "PAYLOAD_TOO_LARGE") {
      return new AgentFileTooLargeError(path);
    }
  }
  return new AgentFilesUnreachableError(
    agentId,
    err instanceof Error ? err.message : String(err),
  );
}
