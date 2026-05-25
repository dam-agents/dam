import { z } from "zod";
import { t } from "../../trpc.js";

export const connectionsRouter = t.router({
  listTemplates: t.procedure.query(({ ctx }) =>
    ctx.connections.listTemplates(),
  ),

  list: t.procedure.query(({ ctx }) => ctx.connections.listConnections()),

  get: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.connections.getConnection(input.id)),

  /**
   * Create a Connection by projecting user-typed inputs through a template.
   * The template's `inputs` schema validates `inputs` server-side; on
   * success, the SecretStore + Postgres rows are written atomically and
   * the new connection id is returned. The UI never assembles `auth` or
   * `contributions` itself — those are template-derived.
   */
  create: t.procedure
    .input(
      z.object({
        templateId: z.string().min(1),
        name: z.string().min(1).optional(),
        inputs: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.connections.createFromTemplate(input).then((id) => ({ id })),
    ),

  /**
   * Start the OAuth authorization-code flow for an existing Connection.
   * Returns the provider's authorize URL; the UI redirects the user and
   * the provider eventually lands back at `/api/oauth/callback`.
   */
  startOAuth: t.procedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.connections.startOAuth(input.connectionId),
    ),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.connections.deleteConnection(input.id)),

  getAgentConnections: t.procedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.connections.getAgentConnections(input.agentId),
    ),

  setAgentConnections: t.procedure
    .input(
      z.object({
        agentId: z.string().min(1),
        connectionIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.connections.setAgentConnections(input.agentId, input.connectionIds),
    ),
});
