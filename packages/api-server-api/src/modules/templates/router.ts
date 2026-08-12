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
    // The wizard needs the backend to split VM-backed templates from container
    // ones; the rest of the backend block is server-side detail.
    vm: tmpl.spec.backend?.type === "vm",
    // The template's default Size (#1900) — seeds the create wizard's
    // sliders; absent dimensions fall to the chart default there.
    size: {
      cpu: tmpl.spec.resources?.limits?.cpu,
      memory: tmpl.spec.resources?.limits?.memory,
    },
  };
}

// Templates are operator-installed catalog data — read-only from clients.
// Any agent-scoped principal can list them: an `agents:read` key needs the
// catalog to display agent provenance; an `agents:manage` key needs it to
// pick a template at create time.
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
