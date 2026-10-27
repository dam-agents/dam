import { useMutation } from "@tanstack/react-query";

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

export function useSetAgentEnvironmentMembers() {
  return useMutation({
    ...trpc.environments.setAgentMembers.mutationOptions(),
    meta: {
      ...invalidatesEnvironments,
      errorToast: "Couldn't save the agent's Environment members",
    },
  });
}

export function useSetEnvironmentMembers() {
  return useMutation({
    ...trpc.environments.setMembers.mutationOptions(),
    meta: {
      ...invalidatesEnvironments,
      errorToast: "Couldn't save who may open the Environment",
    },
  });
}
