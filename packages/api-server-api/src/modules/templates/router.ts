import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import { readAgentProcedure } from "../../auth-procedures.js";
import { templateGetInputSchema } from "./schemas.js";
import type { Template } from "./types.js";

function toView(tmpl: Template) {
  return {
    id: tmpl.id,
    name: tmpl.name,
    image: tmpl.spec.image,
    description: tmpl.spec.description,
    category: tmpl.spec.category ?? "harness",
    tags: tmpl.spec.tags,
    docsUrl: tmpl.spec.docsUrl,
    releaseNotesUrl: tmpl.spec.releaseNotesUrl,
    setupNote: tmpl.spec.setupNote,
    experimental: tmpl.spec.experimental ?? false,
    vm: tmpl.spec.backend?.type === "vm",
    size: {
      cpu: tmpl.spec.resources?.limits?.cpu,
      memory: tmpl.spec.resources?.limits?.memory,
    },
  };
}

export const templatesRouter = t.router({
  list: readAgentProcedure.query(async ({ ctx }) => {
    const templates = await ctx.templates.list();
    return templates.map(toView);
  }),

  get: readAgentProcedure
    .input(templateGetInputSchema)
    .query(async ({ ctx, input }) => {
      const tmpl = await ctx.templates.get(input.id);
      if (!tmpl) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(tmpl);
    }),
});
