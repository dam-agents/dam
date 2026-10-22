import { t } from "../../trpc.js";
import { operatorStatusSchema } from "./schemas.js";

export const operatorRouter = t.router({
  status: t.procedure
    .output(operatorStatusSchema)
    .query(({ ctx }) => ({ isOperator: ctx.user.isOperator === true })),
});
