import type { PromptsService } from "api-server-api";
import type { WrapperFrameSender } from "../../core/wrapper-frame-sender.js";
import {
  createRedisPromptsStore,
  type PromptsStore,
} from "./infrastructure/redis-prompts-store.js";
import {
  createWrapperPromptForwarder,
  type ForwardPrompt,
} from "./infrastructure/wrapper-prompt-forwarder.js";
import {
  createPromptsService,
  type CreatePromptsServiceDeps,
} from "./services/prompts-service.js";
import {
  createPromptsForwarder,
  type PromptsForwarder,
} from "./services/prompts-forwarder.js";

/**
 * Boot-time composition for the prompts outbox + forwarder. Wires the Redis
 * store and the shared `WrapperFrameSender` into a single consumer-group
 * worker that's shared across all owners. The store handle is also returned
 * so the per-request `composePromptsService` can hand it to the tRPC
 * service without re-wiring Redis on every request.
 */
export interface ComposePromptsModuleDeps {
  redisUrl: string;
  redisPassword?: string;
  /** Shared with the approvals delivery sweeper — same primitive, same
   *  one-shot WS pattern, no duplicated WS plumbing. */
  wrapperFrameSender: WrapperFrameSender;
  /** Forwarder consumer name; should be unique per replica so XAUTOCLAIM
   *  can move work off a dead replica. The api-server boot uses
   *  `forwarder-${podName}` or a uuid as fallback. */
  consumerName: string;
  log?: (msg: string) => void;
}

export function composePromptsModule(deps: ComposePromptsModuleDeps): {
  store: PromptsStore;
  forwarder: PromptsForwarder;
} {
  const store = createRedisPromptsStore(deps.redisUrl, {
    password: deps.redisPassword,
  });
  const forward: ForwardPrompt = createWrapperPromptForwarder(deps.wrapperFrameSender);
  const forwarder = createPromptsForwarder({
    store,
    forward,
    consumerName: deps.consumerName,
    log: deps.log,
  });
  return { store, forwarder };
}

/**
 * Per-request composition for the user-facing `prompts.send` tRPC service.
 * Owner-scoped — the service's `send` rejects if the input instance isn't
 * owned by `ownerSub`. Reuses the boot-time Redis store handle.
 */
export type ComposePromptsServiceDeps = CreatePromptsServiceDeps;

export function composePromptsService(
  deps: ComposePromptsServiceDeps,
): { service: PromptsService } {
  return { service: createPromptsService(deps) };
}
