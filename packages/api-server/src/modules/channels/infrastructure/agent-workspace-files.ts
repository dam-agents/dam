import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";

export interface AgentWorkspaceFiles {
  write(input: {
    path: string;
    bytes: Buffer;
    contentType?: string;
  }): Promise<string>;
}

export type AgentWorkspaceFilesFactory = (
  agentId: string,
) => AgentWorkspaceFiles;

export function createAgentWorkspaceFiles(
  trpcUrl: string,
): AgentWorkspaceFiles {
  const client = createTRPCClient<AppRouter>({
    links: [httpLink({ url: trpcUrl })],
  });
  return {
    async write({ path, bytes, contentType }) {
      const result = await client.files.upload.mutate({
        path,
        contentBase64: bytes.toString("base64"),
        ...(contentType ? { contentType } : {}),
        overwrite: true,
      });
      if (!result.absolutePath) {
        throw new Error("the agent did not report where it saved the file");
      }
      return result.absolutePath;
    },
  };
}
