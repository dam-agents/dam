import { t } from "../../trpc.js";
import { artifactApiRequestInputSchema } from "./schemas.js";

export const artifactApiRouter = t.router({
  request: t.procedure
    .input(artifactApiRequestInputSchema)
    .mutation(({ ctx, input }) => ctx.artifactApi.request(input)),
});
