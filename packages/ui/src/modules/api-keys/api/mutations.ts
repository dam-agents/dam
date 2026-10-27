import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const invalidatesList = { invalidates: [trpc.apiKeys.list.queryKey()] };

export function useCreateApiKey() {
  return useMutation({
    ...trpc.apiKeys.create.mutationOptions(),
    meta: { ...invalidatesList, errorToast: "Failed to create API key" },
  });
}

export function useRevokeApiKey() {
  return useMutation({
    ...trpc.apiKeys.revoke.mutationOptions(),
    meta: { ...invalidatesList, errorToast: "Failed to revoke API key" },
  });
}
