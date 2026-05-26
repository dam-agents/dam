import { protectedProcedure, t } from "../../trpc.js";
import { applyStateInput } from "./types.js";

const v1Router = t.router({
  applyState: protectedProcedure
    .input(applyStateInput)
    .mutation(async ({ ctx, input }) => ctx.runtime.applyState(input)),
});

export const runtimeRouter = t.router({
  v1: v1Router,
});
