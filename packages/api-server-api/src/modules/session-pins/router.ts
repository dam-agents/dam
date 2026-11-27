import { t } from "../../trpc.js";
import {
  browserOnlyProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import { sessionPinKeySchema } from "./schemas.js";

export const sessionPinsRouter = t.router({
  list: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.sessionPins.list()),

  pin: browserOnlyProcedure
    .input(sessionPinKeySchema)
    .mutation(({ ctx, input }) => ctx.sessionPins.pin(input)),

  unpin: browserOnlyProcedure
    .input(sessionPinKeySchema)
    .mutation(({ ctx, input }) => ctx.sessionPins.unpin(input)),
});
