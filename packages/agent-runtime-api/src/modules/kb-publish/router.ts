import { t } from "../../trpc.js";
import { kbPublishSyncInputSchema } from "./schemas.js";

export const kbPublishRouter = t.router({
  sync: t.procedure
    .input(kbPublishSyncInputSchema)
    .mutation(({ ctx, input }) => ctx.kbPublish.sync(input)),
});
