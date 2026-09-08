import { t } from "../../trpc.js";
import {
  operateAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import { caseStudyIdInputSchema } from "./schemas.js";

export const caseStudiesRouter = t.router({
  list: readAgentProcedure.query(({ ctx }) => ctx.caseStudies.list()),
  get: readAgentProcedure
    .input(caseStudyIdInputSchema)
    .query(({ ctx, input }) => ctx.caseStudies.get(input.id)),
  release: operateAgentsProcedure
    .input(caseStudyIdInputSchema)
    .mutation(({ ctx, input }) => ctx.caseStudies.release(input.id)),
});
