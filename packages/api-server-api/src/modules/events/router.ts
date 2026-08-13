import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import { readAgentProcedure } from "../../auth-procedures.js";

export const eventsRouter = t.router({
  owner: readAgentProcedure.subscription(({ ctx, signal }) => {
    if (ctx.user.agentIds !== "*") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Live events require an unrestricted principal.",
      });
    }
    return ctx.liveEvents.ownerStream(ctx.user.sub, signal);
  }),
});
