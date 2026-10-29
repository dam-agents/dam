import { z } from "zod";

import type { SpendCallCost } from "./types.js";

export const HARNESS_CALL_COSTS_MAX = 100;

export const harnessCallCostsInputSchema = z.object({
  routerCallIds: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(HARNESS_CALL_COSTS_MAX),
});

export type HarnessCallCostsInput = z.infer<typeof harnessCallCostsInputSchema>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the measured cost of an agent's own model calls,
 * by the call id the Model Router stamped, so a harness can show what its
 * Session cost in the same figures as the Usage page. A call the ledger has
 * not priced yet is absent from the answer.
 */
export interface SpendCallCostReader {
  callCosts(
    agentId: string,
    routerCallIds: readonly string[],
  ): Promise<SpendCallCost[]>;
}
