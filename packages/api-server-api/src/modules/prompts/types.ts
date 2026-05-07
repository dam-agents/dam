/** Opaque ACP `ContentBlock` — see @agentclientprotocol/sdk types. The
 *  contract package keeps it as `unknown` to avoid forcing every consumer
 *  to depend on the SDK; runtime validation lives in the router. */
export type AcpContentBlock = unknown;

export interface SendPromptInput {
  instanceId: string;
  sessionId: string;
  prompt: AcpContentBlock[];
  /** Caller-generated UUID. Doubles as the idempotency key (server returns
   *  the same id on retries within 1 hour) and as `_meta.promptId` on the
   *  synthesized `user_message_chunk` — UIs use it to dedupe their
   *  optimistic bubble against the wrapper's fan-out. */
  promptId: string;
}

export interface SendPromptResult {
  promptId: string;
  /** True when this call hit the idempotency cache rather than appending a
   *  new entry. Useful for client-side telemetry; behaviorally a no-op. */
  deduped: boolean;
}

export interface PromptsService {
  send(input: SendPromptInput): Promise<SendPromptResult>;
}
