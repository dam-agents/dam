import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import { templateGetInputSchema } from "./schemas.js";
import type { Template } from "./types.js";

function toView(tmpl: Template) {
  return {
    id: tmpl.id,
    name: tmpl.name,
    image: tmpl.spec.image,
    description: tmpl.spec.description,
  };
}

export const templatesRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    const templates = await ctx.templates.list();
    return templates.map(toView);
  }),

  get: t.procedure
    .input(templateGetInputSchema)
    .query(async ({ ctx, input }) => {
      const tmpl = await ctx.templates.get(input.id);
      if (!tmpl) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(tmpl);
    }),
});
