import type {
  RuntimeDeliveryService,
  TriggerEventHandler,
} from "./modules/runtime/types.js";

/**
 * Context bound on every harness API request. Populated by the harness API
 * middleware that resolves the calling agent's identity (from the
 * AuthorizationPolicy on the per-instance ext-authz Service — see ADR-041).
 */
export interface HarnessContext {
  agentId: string;
  runtimeDelivery: RuntimeDeliveryService;
  triggerHandler: TriggerEventHandler;
}
