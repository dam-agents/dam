import { t } from "../../trpc.js";
import { browserOnlyProcedure } from "../../auth-procedures.js";
import {
  workspaceCreateInputSchema,
  workspaceMembersInputSchema,
  workspaceRemoveMemberInputSchema,
  workspaceSetMemberInputSchema,
} from "./schemas.js";

export const workspacesRouter = t.router({
  list: browserOnlyProcedure.query(({ ctx }) => ctx.workspaces.list()),

  current: browserOnlyProcedure.query(({ ctx }) => ctx.workspace ?? null),

  create: browserOnlyProcedure
    .input(workspaceCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.workspaces.create(input.name)),

  members: browserOnlyProcedure
    .input(workspaceMembersInputSchema)
    .query(({ ctx, input }) => ctx.workspaces.members(input.workspaceId)),

  setMember: browserOnlyProcedure
    .input(workspaceSetMemberInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.workspaces.setMember(input.workspaceId, input.email, input.role),
    ),

  removeMember: browserOnlyProcedure
    .input(workspaceRemoveMemberInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.workspaces.removeMember(input.workspaceId, input.email),
    ),
});
