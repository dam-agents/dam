import { protectedProcedure, t } from "../../trpc.js";
import {
  kbPublishExecuteInputSchema,
  kbPublishPlanInputSchema,
} from "./schemas.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: both procedures return the domain Result as
 * data instead of throwing — the api-server orchestrator needs the typed
 * failure codes intact across the wire, and a thrown tRPC error would fold
 * them into an opaque message (transport errors still surface as tRPC
 * errors, keeping the two failure classes distinguishable).
 */
export const kbPublishRouter = t.router({
  plan: protectedProcedure
    .input(kbPublishPlanInputSchema)
    .mutation(({ ctx, input }) => ctx.kbPublish.plan(input)),

  execute: protectedProcedure
    .input(kbPublishExecuteInputSchema)
    .mutation(({ ctx, input }) => ctx.kbPublish.execute(input)),
});
