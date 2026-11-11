import { t } from "../../trpc.js";

export const nativeLoginRouter = t.router({
  status: t.procedure.query(({ ctx }) => ctx.nativeLogin.status()),
});
