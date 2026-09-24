import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import {
  ARTIFACT_API_TIMEOUT_MS,
  type AppRouter,
  type ArtifactApiRequestInput,
} from "agent-runtime-api";
import type { ArtifactCallAgentApiResult } from "api-server-api";

import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

const RUNTIME_TIMEOUT_HEADROOM_MS = 5_000;
const REQUEST_TIMEOUT_MS =
  ARTIFACT_API_TIMEOUT_MS + RUNTIME_TIMEOUT_HEADROOM_MS;

export interface AgentApiPodClient {
  request(
    agentId: string,
    input: ArtifactApiRequestInput,
  ): Promise<ArtifactCallAgentApiResult>;
}

function isMissingProcedure(err: unknown): boolean {
  if (!(err instanceof TRPCClientError)) return false;
  const data = err.data as { code?: unknown } | null | undefined;
  return data?.code === "NOT_FOUND";
}

export function createAgentApiPodClient(namespace: string): AgentApiPodClient {
  return {
    async request(agentId, input) {
      const client = createTRPCClient<AppRouter>({
        links: [
          httpLink({
            url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
            fetch: (request, init) =>
              fetch(request, {
                ...init,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
              }),
          }),
        ],
      });
      try {
        return await client.artifactApi.request.mutate(input);
      } catch (err) {
        return {
          ok: false,
          reason: isMissingProcedure(err)
            ? "unsupported-runtime"
            : "agent-unreachable",
        };
      }
    },
  };
}
