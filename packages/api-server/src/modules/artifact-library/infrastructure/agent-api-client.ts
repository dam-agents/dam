import { TRPCClientError } from "@trpc/client";
import {
  ARTIFACT_API_TIMEOUT_MS,
  type ArtifactApiRelayInput,
} from "agent-runtime-api";
import type { ArtifactCallAgentApiResult } from "api-server-api";

import { agentServiceClient } from "../../../core/agent-service-client.js";

const RUNTIME_TIMEOUT_HEADROOM_MS = 5_000;
const REQUEST_TIMEOUT_MS =
  ARTIFACT_API_TIMEOUT_MS + RUNTIME_TIMEOUT_HEADROOM_MS;

export interface AgentApiClient {
  request(
    agentId: string,
    input: ArtifactApiRelayInput,
  ): Promise<ArtifactCallAgentApiResult>;
}

function isMissingProcedure(err: unknown): boolean {
  if (!(err instanceof TRPCClientError)) return false;
  const data = err.data as { code?: unknown } | null | undefined;
  return data?.code === "NOT_FOUND";
}

export function createAgentApiClient(namespace: string): AgentApiClient {
  return {
    async request(agentId, input) {
      const client = agentServiceClient(agentId, namespace, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        batch: false,
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
