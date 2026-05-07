import { randomInt } from "node:crypto";

import type { WrapperFrameSender } from "../../../core/wrapper-frame-sender.js";
import type { PromptEnvelope } from "../domain/types.js";

/** Function the consumer-group worker calls per stream entry. */
export type ForwardPrompt = (envelope: PromptEnvelope) => Promise<void>;

/**
 * Builds a `session/prompt` JSON-RPC frame from an envelope and ships it via
 * the shared `WrapperFrameSender`. Fire-and-forget: ACP prompt responses
 * can take minutes, so holding the WS for a full prompt would tie one
 * consumer slot to one in-flight prompt. The wrapper records this
 * (closing) channel as the active prompt's owner, nullifies our reference
 * on detach, and keeps the prompt running. Other engaged channels (the
 * UI's WS) receive the synthesized `user_message_chunk` and the eventual
 * `platform_turn_ended` via the wrapper's existing fan-out.
 *
 * Known shortcoming: if the wrapper rejects the prompt (PROMPT_QUEUE_CAP
 * exceeded, session-not-found), the JSON-RPC error response is silently
 * dropped — we close the WS as soon as `send` resolves, before the wrapper
 * has had a chance to reply. The forwarder XACKs the entry and moves on,
 * so the user sees no `platform_turn_ended` and the assistant bubble
 * streams forever. Rare in practice (queue cap is 32 per session,
 * session-not-found requires UI/wrapper sync drift). Future tightening:
 * read responses with a short timeout and surface non-success as a
 * forwarder error so XAUTOCLAIM retries.
 */
export function createWrapperPromptForwarder(
  sender: WrapperFrameSender,
): ForwardPrompt {
  return async function forwardPrompt(envelope) {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      // Per-call random id. The wrapper-side response (if any) lands at our
      // about-to-close channel and is silently dropped, so the value isn't
      // load-bearing — but a constant is a footgun if anyone ever reuses
      // the WS, and a random integer costs nothing.
      id: randomInt(1, 2 ** 31 - 1),
      method: "session/prompt",
      params: {
        sessionId: envelope.sessionId,
        prompt: envelope.prompt,
        _meta: { promptId: envelope.promptId },
      },
    });
    await sender.send(envelope.instanceId, frame);
  };
}
