import { operatorProcedure } from "../../auth-procedures.js";
import { t } from "../../trpc.js";
import {
  accessListAddInputSchema,
  accessListRemoveInputSchema,
  accessListSchema,
} from "./schemas.js";

export const accessListRouter = t.router({
  list: operatorProcedure
    .output(accessListSchema)
    .query(({ ctx }) => ctx.accessList.list()),

  add: operatorProcedure
    .input(accessListAddInputSchema)
    .output(accessListSchema)
    .mutation(({ ctx, input }) => ctx.accessList.add(input)),

  remove: operatorProcedure
    .input(accessListRemoveInputSchema)
    .output(accessListSchema)
    .mutation(({ ctx, input }) => ctx.accessList.remove(input)),
});
