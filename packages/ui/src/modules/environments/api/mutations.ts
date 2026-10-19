import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";

const invalidatesEnvironments = {
  invalidates: [trpc.environments.pathKey()],
};

export function useExtendEnvironment() {
  return useMutation({
    ...trpc.environments.extend.mutationOptions(),
    meta: {
      ...invalidatesEnvironments,
      errorToast: "Couldn't change the expiry",
    },
  });
}

export function useDeleteEnvironment() {
  return useMutation({
    ...trpc.environments.delete.mutationOptions(),
    meta: {
      ...invalidatesEnvironments,
      errorToast: "Couldn't delete the Environment",
    },
  });
}

export function useSetEnvironmentAccessList() {
  return useMutation({
    ...trpc.environments.setAccessList.mutationOptions(),
    meta: {
      ...invalidatesEnvironments,
      errorToast: "Couldn't save who may open Environments",
    },
  });
}

export function useToggleEnvironmentConnection() {
  return useMutation({
    mutationFn: (input: { environmentId: string; id: string; on: boolean }) =>
      api.connections.updateAgentConnections.mutate({
        agentId: input.environmentId,
        grant: input.on ? [input.id] : [],
        revoke: input.on ? [] : [input.id],
      }),
    meta: {
      invalidates: [trpc.connections.getAgentConnections.queryKey()],
      errorToast: "Couldn't change the Environment's connections",
    },
  });
}
