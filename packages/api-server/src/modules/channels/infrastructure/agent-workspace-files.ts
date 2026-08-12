import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

/** Writes a file into a running agent's own workspace, so the agent can open it
 *  by path. A channel worker holds this to hand over the documents people
 *  attach: the prompt carries a picture's bytes, but a file has to *be* a file
 *  before a harness can read it. Same surface the web UI's chat uploads use, so
 *  an attachment arrives the same way whichever surface it came from. */
export interface AgentWorkspaceFiles {
  /** Write `bytes` at the workspace-relative `path`, returning the absolute
   *  on-pod path to reference it by. The pod serves this itself, so the agent
   *  must already be awake. */
  write(input: {
    path: string;
    bytes: Buffer;
    contentType?: string;
  }): Promise<string>;
}

/** Bound to the namespace at composition, like the worker's ACP client factory,
 *  so a worker never learns where pods live. */
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
        // Every delivered file carries its own random prefix, so a name that
        // already exists is this same file being written twice.
        overwrite: true,
      });
      if (!result.absolutePath) {
        // The bytes landed somewhere, but a path is the whole point: the agent
        // is handed a `file://` URI or nothing. Guessing one from a default
        // home directory would point it at a file that may not be there.
        throw new Error("the agent did not report where it saved the file");
      }
      return result.absolutePath;
    },
  };
}
