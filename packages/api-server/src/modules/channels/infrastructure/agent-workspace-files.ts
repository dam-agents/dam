import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

/** Writes a file into a running agent's workspace, so the agent can open it by
 *  path — the same surface the web UI's chat uploads use. */
export interface AgentWorkspaceFiles {
  /** Returns the absolute on-pod path. The pod serves this, so it must be awake. */
  write(input: {
    path: string;
    bytes: Buffer;
    contentType?: string;
  }): Promise<string>;
}

/** Namespace-bound at composition, so a worker never learns where pods live. */
export type AgentWorkspaceFilesFactory = (
  agentId: string,
) => AgentWorkspaceFiles;

// Auth on the api-server → agent-runtime hop is enforced at the kernel by the
// agent pod's NetworkPolicy (ingress admitted only from the api-server pod).
// No Bearer header is sent.
export function createAgentWorkspaceFiles(
  agentId: string,
  namespace: string,
): AgentWorkspaceFiles {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({ url: `http://${podBaseUrl(agentId, namespace)}/api/trpc` }),
    ],
  });
  return {
    async write({ path, bytes, contentType }) {
      const result = await client.files.upload.mutate({
        path,
        contentBase64: bytes.toString("base64"),
        ...(contentType ? { contentType } : {}),
        // Each file has a random prefix, so a collision is the same file twice.
        overwrite: true,
      });
      if (!result.absolutePath) {
        // The agent is handed a `file://` URI or nothing; a guessed path could
        // point at a file that is not there.
        throw new Error("the agent did not report where it saved the file");
      }
      return result.absolutePath;
    },
  };
}
