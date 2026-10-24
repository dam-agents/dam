import type { KbPublishSyncInput } from "agent-runtime-api";

import { agentServiceClient } from "../../../core/agent-service-client.js";

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
      try {
        await agentServiceClient(agentId, namespace, {
          timeoutMs: SYNC_TIMEOUT_MS,
          batch: false,
        }).kbPublish.sync.mutate(input);
      } catch (err) {
        throw new KbPublishUnreachableError(
          agentId,
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}
