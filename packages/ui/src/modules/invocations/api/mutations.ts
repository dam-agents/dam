import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useStopDelegation() {
  return useMutation({
    ...trpc.invocations.stop.mutationOptions(),
    meta: {
      invalidates: [trpc.invocations.pathKey(), trpc.agents.pathKey()],
      errorToast: "Couldn't stop the temporary agent",
    },
  });
}

export function useDeleteKeptSubAgent() {
  return useMutation({
    ...trpc.agents.delete.mutationOptions(),
    meta: {
      invalidates: [trpc.invocations.pathKey(), trpc.agents.pathKey()],
      errorToast: "Couldn't delete the sub-agent",
    },
  });
}
