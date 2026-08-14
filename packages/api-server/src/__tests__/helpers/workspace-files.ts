import type { AgentWorkspaceFilesFactory } from "../../modules/channels/infrastructure/agent-workspace-files.js";

export function stubWorkspaceFiles(): AgentWorkspaceFilesFactory {
  return () => ({
    write: async ({ path }) => `/home/agent/${path}`,
  });
}

export type WrittenWorkspaceFile = {
  agentId: string;
  path: string;
  bytes: Buffer;
  contentType?: string;
};

export function recordingWorkspaceFiles(opts?: { failWith?: Error }): {
  factory: AgentWorkspaceFilesFactory;
  written: WrittenWorkspaceFile[];
} {
  const written: WrittenWorkspaceFile[] = [];
  const factory: AgentWorkspaceFilesFactory = (agentId) => ({
    async write({ path, bytes, contentType }) {
      if (opts?.failWith) throw opts.failWith;
      written.push({
        agentId,
        path,
        bytes,
        ...(contentType ? { contentType } : {}),
      });
      return `/home/agent/${path}`;
    },
  });
  return { factory, written };
}
