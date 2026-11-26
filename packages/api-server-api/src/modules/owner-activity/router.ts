import { t } from "../../trpc.js";
import { browserOnlyProcedure } from "../../auth-procedures.js";

export const ownerActivityRouter = t.router({
  touch: browserOnlyProcedure.mutation(({ ctx }) => ctx.ownerActivity.touch()),
});
