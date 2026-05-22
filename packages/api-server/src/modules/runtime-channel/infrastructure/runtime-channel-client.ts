import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import type {
  RuntimeChannelApplyStateResult,
  SignalEvent,
  StateEvent,
} from "api-server-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

export interface RuntimeChannelClient {
  applyState(
    agentId: string,
    state: StateEvent,
  ): Promise<RuntimeChannelApplyStateResult>;
  deliverSignal(agentId: string, signal: SignalEvent): Promise<void>;
}

export class RuntimeChannelUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeChannelUnreachableError";
  }
}

function makeClient(agentId: string, namespace: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
      }),
    ],
  });
}

function isConnectionError(e: unknown): boolean {
  if (e instanceof TRPCClientError) {
    const msg = e.message.toLowerCase();
    return (
      msg.includes("fetch failed") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("network")
    );
  }
  return false;
}

export function createRuntimeChannelClient(
  namespace: string,
): RuntimeChannelClient {
  return {
    async applyState(agentId, state) {
      try {
        return await makeClient(
          agentId,
          namespace,
        ).runtimeChannel.v1.applyState.mutate({ state });
      } catch (e) {
        if (isConnectionError(e)) {
          throw new RuntimeChannelUnreachableError(
            `runtime-channel applyState ${agentId}: ${(e as Error).message}`,
          );
        }
        throw new Error(
          `runtime-channel applyState ${agentId}: ${(e as Error).message}`,
        );
      }
    },

    async deliverSignal(agentId, signal) {
      try {
        await makeClient(
          agentId,
          namespace,
        ).runtimeChannel.v1.deliverSignal.mutate({ signal });
      } catch (e) {
        if (isConnectionError(e)) {
          throw new RuntimeChannelUnreachableError(
            `runtime-channel deliverSignal ${agentId}: ${(e as Error).message}`,
          );
        }
        throw new Error(
          `runtime-channel deliverSignal ${agentId}: ${(e as Error).message}`,
        );
      }
    },
  };
}
