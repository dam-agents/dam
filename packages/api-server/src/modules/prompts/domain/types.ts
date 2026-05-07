/**
 * Single prompt, durably enqueued for async forwarding to the wrapper. The
 * envelope is what the consumer-group worker picks up out of the
 * `prompts:outbox` Redis Stream and feeds to a one-shot WS connection to
 * the wrapper.
 */
export interface PromptEnvelope {
  promptId: string;
  instanceId: string;
  sessionId: string;
  ownerSub: string;
  /** Opaque ACP `ContentBlock[]` array — see @agentclientprotocol/sdk. */
  prompt: unknown[];
}
