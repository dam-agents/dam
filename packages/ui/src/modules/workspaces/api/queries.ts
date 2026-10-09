import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useWorkspaces() {
  return useQuery({
    ...trpc.workspaces.list.queryOptions(),
    meta: { errorToast: "Couldn't load workspaces" },
  });
}

export function useCurrentWorkspace() {
  return useQuery(trpc.workspaces.current.queryOptions());
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    ...trpc.workspaces.members.queryOptions({ workspaceId: workspaceId ?? "" }),
    enabled: workspaceId !== undefined,
    meta: { errorToast: "Couldn't load workspace members" },
  });
}
