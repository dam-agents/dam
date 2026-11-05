import { t } from "../../trpc.js";
import {
  agentPermission,
  agentTarget,
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import {
  environmentAgentLookupInputSchema,
  environmentAgentMembersInputSchema,
  environmentExtendInputSchema,
  environmentIdInputSchema,
  environmentListInputSchema,
  environmentMembersInputSchema,
} from "./schemas.js";
import type { AgentTarget } from "../agents/permissions.js";

function environmentTarget(environmentId: string): AgentTarget {
  return { kind: "environment", environmentId };
}

export const environmentsRouter = t.router({
  list: readAgentProcedure
    .input(environmentListInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.owningAgentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.owningAgentId);
      return ctx.environments.list(input.owningAgentId);
    }),

  listAll: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.environments.listAll()),

  agentMembers: readAgentProcedure
    .use(requireWildcardBinding)
    .input(environmentListInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.owningAgentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.owningAgentId);
      return ctx.environments.agentMembers(input.owningAgentId);
    }),

  setAgentMembers: manageAgentsProcedure
    .input(environmentAgentMembersInputSchema)
    .use(
      agentPermission("environments", (input) =>
        agentTarget(input.owningAgentId),
      ),
    )
    .mutation(({ ctx, input }) => {
      checkAgentBinding(ctx, input.owningAgentId);
      return ctx.environments.setAgentMembers(input.owningAgentId, {
        emails: input.emails,
        ...(input.agentIds ? { agentIds: input.agentIds } : {}),
      });
    }),

  setMembers: manageAgentsProcedure
    .input(environmentMembersInputSchema)
    .use(
      agentPermission("environments", (input) => environmentTarget(input.id)),
    )
    .mutation(({ ctx, input }) =>
      ctx.environments.setMembers(input.id, {
        emails: input.emails,
        ...(input.agentIds ? { agentIds: input.agentIds } : {}),
      }),
    ),

  // UNIT_BOUNDARY_DESCRIPTION: names the Agent an id a person typed into a list stands for, before they save it. An id is unguessable, so its holder already knew it; the answer says no more than the Public Agent Page does for the same id.
  lookupAgent: readAgentProcedure
    .use(requireWildcardBinding)
    .input(environmentAgentLookupInputSchema)
    .query(({ ctx, input }) => ctx.environments.lookupAgent(input.agentId)),

  extend: manageAgentsProcedure
    .input(environmentExtendInputSchema)
    .use(
      agentPermission("environments", (input) => environmentTarget(input.id)),
    )
    .mutation(({ ctx, input }) =>
      ctx.environments.extend(
        input.id,
        input.expiresAt === "never" ? "never" : new Date(input.expiresAt),
      ),
    ),

  delete: manageAgentsProcedure
    .input(environmentIdInputSchema)
    .use(
      agentPermission("environments", (input) => environmentTarget(input.id)),
    )
    .mutation(({ ctx, input }) => ctx.environments.delete(input.id)),
});
