import {
  operateAgentsProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import { t } from "../../trpc.js";

import {
  costReviewDismissInputSchema,
  costReviewStartInputSchema,
} from "./schemas.js";

export const costReviewsRouter = t.router({
  start: operateAgentsProcedure
    .use(requireWildcardBinding)
    .input(costReviewStartInputSchema)
    .mutation(({ ctx, input }) => ctx.costReviews.start(input.agentId)),

  dismiss: operateAgentsProcedure
    .use(requireWildcardBinding)
    .input(costReviewDismissInputSchema)
    .mutation(({ ctx, input }) => ctx.costReviews.dismiss(input.agentIds)),
});
