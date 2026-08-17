import { t } from "../../trpc.js";
import {
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";

export const eventsRouter = t.router({
  owner: readAgentProcedure
    .use(requireWildcardBinding)
    .subscription(({ ctx, signal }) =>
      ctx.liveEvents.ownerStream(ctx.user.sub, signal),
    ),
});
