import { t } from "../../trpc.js";
import { artifactApiRelayInputSchema } from "./schemas.js";

export const artifactApiRouter = t.router({
  request: t.procedure
    .input(artifactApiRelayInputSchema)
    .mutation(({ ctx, input }) => ctx.artifactApi.request(input)),
});
