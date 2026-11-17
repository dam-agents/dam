import {
  operateAgentsProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import { t } from "../../trpc.js";

import { securityCheckReportInputSchema } from "./schemas.js";

export const securityChecksRouter = t.router({
  /* UNIT_BOUNDARY_DESCRIPTION: the assistant's own report of what its security check found, over the Connection that lets it act as its owner. The record it writes is the person's, not one Agent's, so a key bound to some agents may not reach it. */
  report: operateAgentsProcedure
    .use(requireWildcardBinding)
    .input(securityCheckReportInputSchema)
    .mutation(({ ctx, input }) => ctx.securityChecks.report(input)),
});
