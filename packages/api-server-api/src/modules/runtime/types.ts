import { helloInput, helloResult } from "agent-runtime-api";
import type { HelloInput, HelloResult } from "agent-runtime-api";

/**
 * Harness API runtime channel contracts (ADR-052). The only route the
 * agent calls back into:
 *   - `runtime.v1.hello` — boot/wake catch-up; server returns the same
 *     envelope as `applyState` if anything diverged.
 *
 * Per-kind event work (e.g. `trigger`) runs entirely agent-side — the
 * agent's runtime channel dispatches against its in-process ACP runtime
 * with no callback to api-server.
 */
export { helloInput, helloResult };
export type { HelloInput, HelloResult };

/**
 * Service contract implemented by api-server's Runtime Delivery context.
 * The harness tRPC router is a thin wrapper around this.
 */
export interface RuntimeDeliveryService {
  hello(agentId: string, input: HelloInput): Promise<HelloResult>;
}
