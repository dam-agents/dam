import { z } from "zod";

export const workspaceRoleSchema = z.enum(["admin", "editor", "reader"]);

export const workspaceIdSchema = z.string().uuid();

const memberEmailSchema = z
  .string()
  .trim()
  .email()
  .transform((email) => email.toLowerCase());

export const workspaceCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const workspaceMembersInputSchema = z.object({
  workspaceId: workspaceIdSchema,
});

export const workspaceSetMemberInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  email: memberEmailSchema,
  role: workspaceRoleSchema,
});

export const workspaceRemoveMemberInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  email: memberEmailSchema,
});
