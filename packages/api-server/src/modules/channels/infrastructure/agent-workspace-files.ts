import { agentPodClient } from "../../../core/agent-pod-client.js";

export interface AgentWorkspaceFiles {
  write(input: {
    path: string;
    bytes: Buffer;
    contentType?: string;
  }): Promise<string>;
}

// UNIT_BOUNDARY_DESCRIPTION: workspace writes carry a spilled satellite log or a file a channel hands its Agent, which can run to megabytes on a slow disk, so they get four times the round-trip budget a plain call gets.
const WRITE_TIMEOUT_MS = 60_000;

export type AgentWorkspaceFilesFactory = (
  agentId: string,
) => AgentWorkspaceFiles;

export function createAgentWorkspaceFiles(
  agentId: string,
  namespace: string,
): AgentWorkspaceFiles {
  const client = agentPodClient(agentId, namespace, {
    timeoutMs: WRITE_TIMEOUT_MS,
    batch: false,
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
