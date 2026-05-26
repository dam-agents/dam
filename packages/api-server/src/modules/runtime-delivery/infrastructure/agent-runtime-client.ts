import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import type { ApplyStateInput, ApplyStateResult } from "api-server-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

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
      const r = await client.runtime.v1.applyState.mutate(
        input as unknown as Parameters<
          typeof client.runtime.v1.applyState.mutate
        >[0],
      );
      return r as ApplyStateResult;
    },
  };
}
