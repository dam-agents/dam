import { t } from "../../trpc.js";
import { readAgentProcedure } from "../../auth-procedures.js";

export const linksRouter = t.router({
  all: readAgentProcedure.query(({ ctx }) => ctx.links),
});
