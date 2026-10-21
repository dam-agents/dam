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

export function useSetEnvironmentAccessList() {
  return useMutation({
    ...trpc.environments.setAccessList.mutationOptions(),
    meta: {
      ...invalidatesEnvironments,
      errorToast: "Couldn't save who may open Environments",
    },
  });
}
