import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useCreateWorkspace() {
  return useMutation({
    ...trpc.workspaces.create.mutationOptions(),
    meta: {
      invalidates: [trpc.workspaces.list.queryKey()],
      errorToast: "Failed to create workspace",
    },
  });
}

const invalidatesMembers = {
  invalidates: [trpc.workspaces.members.queryKey()],
};

export function useSetWorkspaceMember() {
  return useMutation({
    ...trpc.workspaces.setMember.mutationOptions(),
    meta: { ...invalidatesMembers, errorToast: "Failed to save member" },
  });
}

export function useRemoveWorkspaceMember() {
  return useMutation({
    ...trpc.workspaces.removeMember.mutationOptions(),
    meta: { ...invalidatesMembers, errorToast: "Failed to remove member" },
  });
}
