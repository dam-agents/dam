import { protectedProcedure, t } from "../../trpc.js";

export const harnessConfigRouter = t.router({
  current: protectedProcedure.query(({ ctx }) =>
    ctx.harnessConfig.readCurrent(),
  ),
});
