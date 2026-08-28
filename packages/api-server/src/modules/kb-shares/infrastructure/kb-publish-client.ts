import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter, KbPublishSyncInput } from "agent-runtime-api";

import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

const SYNC_TIMEOUT_MS = 10_000;

export class KbPublishUnreachableError extends Error {
  constructor(agentId: string, cause: string) {
    super(`agent ${agentId} kb-publish api unreachable: ${cause}`);
    this.name = "KbPublishUnreachableError";
  }
}

export interface KbPublishPodClient {
  sync(agentId: string, input: KbPublishSyncInput): Promise<void>;
}

export function createKbPublishPodClient(
  namespace: string,
): KbPublishPodClient {
  return {
    async sync(agentId, input) {
      const client = createTRPCClient<AppRouter>({
        links: [
          httpLink({
            url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
            fetch: (request, init) =>
              fetch(request, {
                ...init,
                signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
              }),
          }),
        ],
      });
      try {
        await client.kbPublish.sync.mutate(input);
      } catch (err) {
        throw new KbPublishUnreachableError(
          agentId,
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}
