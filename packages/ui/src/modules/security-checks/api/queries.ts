import { skipToken, useMutation, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useSecurityCheckLevel(enabled: boolean) {
  return useQuery({
    ...trpc.securityChecks.level.queryOptions(enabled ? undefined : skipToken),
    meta: { errorToast: "Couldn't load the security advisory's level" },
  });
}

export function useSetSecurityCheckLevel() {
  return useMutation({
    ...trpc.securityChecks.setLevel.mutationOptions(),
    meta: {
      invalidates: [
        trpc.securityChecks.level.queryKey(),
        trpc.schedules.list.pathKey(),
        trpc.schedules.listForOwner.pathKey(),
        trpc.attention.listForOwner.queryKey(),
      ],
      errorToast: "Couldn't change the security advisory",
    },
  });
}
