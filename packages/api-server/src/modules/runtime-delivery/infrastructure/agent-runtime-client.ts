import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import type { ApplyStateInput, ApplyStateResult } from "api-server-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

export const APPLY_STATE_TIMEOUT_MS = 60_000;

type FetchLike = NonNullable<Parameters<typeof httpLink>[0]["fetch"]>;

export interface AgentRuntimeClient {
  applyState(input: ApplyStateInput): Promise<ApplyStateResult>;
}

export interface AgentRuntimeClientOpts {
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createAgentRuntimeClient(
  agentId: string,
  namespace: string,
  opts: AgentRuntimeClientOpts = {},
): AgentRuntimeClient {
  const timeoutMs = opts.timeoutMs ?? APPLY_STATE_TIMEOUT_MS;
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
        fetch: opts.fetch,
      }),
    ],
  });
  return {
    async applyState(input: ApplyStateInput): Promise<ApplyStateResult> {
      const r = await client.runtime.v1.applyState.mutate(
        input as unknown as Parameters<
          typeof client.runtime.v1.applyState.mutate
        >[0],
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      return r as ApplyStateResult;
    },
  };
}
