import {
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import { t } from "../../trpc.js";
import { editorEmailOf } from "../agents/editor-email.js";

export const eventsRouter = t.router({
  owner: readAgentProcedure
    .use(requireWildcardBinding)
    .subscription(({ ctx, signal }) =>
      ctx.liveEvents.ownerStream(
        { sub: ctx.user.sub, editorEmail: editorEmailOf(ctx.user) },
        signal,
      ),
    ),
});
