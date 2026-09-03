import { protectedProcedure, t } from "../../trpc.js";
import { kbPublishSyncInputSchema } from "./schemas.js";

export const kbPublishRouter = t.router({
  sync: protectedProcedure
    .input(kbPublishSyncInputSchema)
    .mutation(({ ctx, input }) => ctx.kbPublish.sync(input)),
});
