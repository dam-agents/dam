import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import type { ApplyStateInput, ApplyStateResult } from "api-server-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

/**
 * api-server → agent-runtime caller for `runtime.v1.applyState` (ADR-052).
 * One client per agent — the URL is derived from the agent's StatefulSet
 * pod DNS name. The NetworkPolicy on the agent pod admits ingress on this
 * port only from api-server replicas, so no in-process auth is added.
 */
export interface AgentRuntimeClient {
  applyState(input: ApplyStateInput): Promise<ApplyStateResult>;
}

export function createAgentRuntimeClient(
  agentId: string,
  namespace: string,
): AgentRuntimeClient {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
      }),
    ],
  });
  return {
    async applyState(input: ApplyStateInput): Promise<ApplyStateResult> {
      // tRPC client's response inference creates a structurally-equal but
      // nominally-distinct ApplyStateResult. Same wire shape — cast.
      const r = await client.runtime.v1.applyState.mutate(
        input as unknown as Parameters<
          typeof client.runtime.v1.applyState.mutate
        >[0],
      );
      return r as ApplyStateResult;
    },
  };
}
