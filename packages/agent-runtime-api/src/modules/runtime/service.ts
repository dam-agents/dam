import type { ApplyStateInput, ApplyStateResult } from "./types.js";

/**
 * Agent-side service that the runtime channel router invokes. Implementations
 * live in `agent-runtime` (driver dispatcher + event loop). The router is a
 * thin Zod-validating wrapper.
 */
export interface RuntimeChannelService {
  applyState(input: ApplyStateInput): Promise<ApplyStateResult>;
}
