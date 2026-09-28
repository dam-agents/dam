import { t } from "../../trpc.js";

export const harnessConfigRouter = t.router({
  current: t.procedure.query(({ ctx }) => ctx.harnessConfig.readCurrent()),
});
