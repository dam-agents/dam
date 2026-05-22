/** Re-exports the shared event shapes from `api-server-api`; the agent's
 *  tRPC routes use these to validate incoming `applyState` / `deliverSignal`
 *  payloads. Keeping ownership in `api-server-api` keeps the contract package
 *  graph one-way (agent-runtime-api → api-server-api). */
import { z } from "zod";
import { signalEventSchema, stateEventSchema } from "api-server-api";

export {
  contributionSchema,
  signalEventSchema,
  stateEventSchema,
  runtimeChannelApplyStateResultSchema,
} from "api-server-api";
export type {
  Contribution,
  RuntimeChannelApplyStateResult,
  SignalEvent,
  StateEvent,
} from "api-server-api";

export const applyStateInputSchema = z.object({
  state: stateEventSchema,
});

export const deliverSignalInputSchema = z.object({
  signal: signalEventSchema,
});
