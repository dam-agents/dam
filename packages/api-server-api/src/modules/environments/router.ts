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
      return ctx.environments.setAgentMembers(
        input.owningAgentId,
        input.emails,
      );
    }),

  setMembers: manageAgentsProcedure
    .input(environmentMembersInputSchema)
    .use(
      agentPermission("environments", (input) => environmentTarget(input.id)),
    )
    .mutation(({ ctx, input }) =>
      ctx.environments.setMembers(input.id, input.emails),
    ),

  extend: manageAgentsProcedure
    .input(environmentExtendInputSchema)
    .use(
      agentPermission("environments", (input) => environmentTarget(input.id)),
    )
    .mutation(({ ctx, input }) =>
      ctx.environments.extend(input.id, new Date(input.expiresAt)),
    ),

  delete: manageAgentsProcedure
    .input(environmentIdInputSchema)
    .use(
      agentPermission("environments", (input) => environmentTarget(input.id)),
    )
    .mutation(({ ctx, input }) => ctx.environments.delete(input.id)),
});
