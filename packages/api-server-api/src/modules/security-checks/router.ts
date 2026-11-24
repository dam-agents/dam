import {
  browserOnlyProcedure,
  operateAgentsProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import { t } from "../../trpc.js";

import {
  securityCheckReportInputSchema,
  securityCheckSetLevelInputSchema,
} from "./schemas.js";

export const securityChecksRouter = t.router({
  level: readAgentProcedure.query(({ ctx }) => ctx.securityChecks.level()),

  /* UNIT_BOUNDARY_DESCRIPTION: a person's choice of how much their check does, made in the browser only: the top level lets the check run turns on their other Agents, so no key and no Agent may raise it for them. */
  setLevel: browserOnlyProcedure
    .input(securityCheckSetLevelInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.securityChecks.setLevel(input.level);
      return ctx.securityChecks.level();
    }),

  /* UNIT_BOUNDARY_DESCRIPTION: the assistant's own report of what its security check found, over the Connection that lets it act as its owner. The record it writes is the person's, not one Agent's, so a key bound to some agents may not reach it. */
  report: operateAgentsProcedure
    .use(requireWildcardBinding)
    .input(securityCheckReportInputSchema)
    .mutation(({ ctx, input }) => ctx.securityChecks.report(input)),
});
