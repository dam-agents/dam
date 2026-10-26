import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useStopDelegation() {
  return useMutation({
    ...trpc.invocations.stop.mutationOptions(),
    meta: {
      invalidates: [trpc.invocations.pathKey(), trpc.agents.pathKey()],
      errorToast: "Failed to stop the temporary agent",
    },
  });
}
