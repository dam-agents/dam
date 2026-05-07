import { TRPCError } from "@trpc/server";

import type { PromptsService, SendPromptInput } from "api-server-api";
import type { PromptsStore } from "../infrastructure/redis-prompts-store.js";
import type { PromptEnvelope } from "../domain/types.js";

export interface CreatePromptsServiceDeps {
  store: PromptsStore;
  ownerSub: string;
  isInstanceOwnedBy(instanceId: string, ownerSub: string): Promise<boolean>;
}

/**
 * tRPC-facing `prompts.send`. Validates ownership, builds the envelope, and
 * hands it to the Redis store's atomic dedup-or-append. The forwarder
 * (separate replica-shared loop) picks it up async and ships it to the
 * wrapper.
 *
 * The mutation returns the moment the entry is durable in Redis — well
 * before the agent has even seen the prompt. The UI relies on the
 * wrapper's `platform_turn_ended` notification (live, via the existing
 * WS) to know when the agent is done. The originating tab dedupes the
 * wrapper's synthesized `user_message_chunk` against its optimistic
 * bubble using `_meta.promptId`.
 */
export function createPromptsService(deps: CreatePromptsServiceDeps): PromptsService {
  return {
    async send(input: SendPromptInput) {
      if (!await deps.isInstanceOwnedBy(input.instanceId, deps.ownerSub)) {
        // NOT_FOUND, not 500: a missing/unowned instance is a client error,
        // not a server bug. Same wording as approvals' ownership-failure
        // path so callers see one consistent shape.
        throw new TRPCError({ code: "NOT_FOUND", message: "instance not found" });
      }
      const envelope: PromptEnvelope = {
        promptId: input.promptId,
        instanceId: input.instanceId,
        sessionId: input.sessionId,
        ownerSub: deps.ownerSub,
        prompt: input.prompt,
      };
      const result = await deps.store.dedupOrAppend(
        input.promptId,
        JSON.stringify(envelope),
      );
      return { promptId: input.promptId, deduped: result.deduped };
    },
  };
}
