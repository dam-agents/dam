import type { AgentWorkspaceFilesFactory } from "../../modules/channels/infrastructure/agent-workspace-files.js";

/** Inert workspace-file staging for the many worker tests that attach nothing.
 *  Passed explicitly rather than defaulted on the worker: the real dependency is
 *  required there, so a dropped wiring is a type error instead of a silently
 *  reinstated attachment drop. Tests that assert on delivery use
 *  {@link recordingWorkspaceFiles}. */
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

/** Records what a worker wrote into the pod, and answers with the absolute path
 *  the pod would. `failWith` makes every write fail, for the withheld path. */
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
