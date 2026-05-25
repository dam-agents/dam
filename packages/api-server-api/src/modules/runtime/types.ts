import { z } from "zod";
import {
  helloInput,
  helloResult,
  triggerEventPayload,
} from "agent-runtime-api";
import type {
  HelloInput,
  HelloResult,
  TriggerEventPayload,
} from "agent-runtime-api";

/**
 * Harness API runtime channel contracts (ADR-052). These are the routes the
 * agent calls back into:
 *   - `runtime.v1.hello` — boot/wake catch-up; server returns the same envelope
 *     as `applyState` if anything diverged.
 *   - `runtime.v1.events.<kind>` — per-kind work handler. The agent's event
 *     loop calls one of these for each event in the payload's `events[]`.
 *
 * The work handler is idempotent on the event's stable `id`. A redelivered
 * event finds the existing side-effect row and returns it without redoing work.
 */

export { helloInput, helloResult };
export type { HelloInput, HelloResult };

export const fireTriggerInput = z.object({
  // Stable event id from `runtime_events.id`. Unique constraint on the
  // side-effect table (`trigger_dispatches.event_id`) catches redelivery.
  id: z.string().min(1),
  payload: triggerEventPayload,
});
export type FireTriggerInput = z.infer<typeof fireTriggerInput>;

export const fireTriggerResult = z.object({
  sessionId: z.string(),
  stopReason: z.string().optional(),
});
export type FireTriggerResult = z.infer<typeof fireTriggerResult>;

export type { TriggerEventPayload };

/**
 * Service contract implemented by api-server's Runtime Delivery context.
 * The harness tRPC router is a thin wrapper around this.
 */
export interface RuntimeDeliveryService {
  hello(agentId: string, input: HelloInput): Promise<HelloResult>;
}

/**
 * Service contract implemented by the per-kind event-handler module. One
 * implementation per Event kind; the harness router routes by kind.
 */
export interface TriggerEventHandler {
  fire(agentId: string, input: FireTriggerInput): Promise<FireTriggerResult>;
}
