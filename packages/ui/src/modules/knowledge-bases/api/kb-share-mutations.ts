import { useMutation } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

const invalidatesShares = [trpc.kbShares.pathKey()];

export function useShareKb() {
  return useMutation({
    ...trpc.kbShares.create.mutationOptions(),
    meta: {
      invalidates: invalidatesShares,
      errorToast: "Couldn't share the knowledge base",
    },
  });
}

export function useRefreshKbShare() {
  return useMutation({
    ...trpc.kbShares.refresh.mutationOptions(),
    meta: {
      invalidates: invalidatesShares,
      errorToast: "Couldn't start the refresh",
    },
  });
}

export function useRotateKbShare() {
  return useMutation({
    ...trpc.kbShares.rotate.mutationOptions(),
    meta: {
      invalidates: invalidatesShares,
      errorToast: "Couldn't rotate the share link",
    },
  });
}

export function useRevokeKbShare() {
  return useMutation({
    ...trpc.kbShares.revoke.mutationOptions(),
    meta: {
      invalidates: invalidatesShares,
      errorToast: "Couldn't stop sharing",
    },
  });
}

export function useRevealKbShare() {
  return useMutation({
    ...trpc.kbShares.reveal.mutationOptions(),
    meta: { errorToast: "Couldn't reveal the share link" },
  });
}

export function useSetKbShareName() {
  return useMutation(
    trpc.kbShares.setName.mutationOptions({
      onSettled: (view, _error, { agentId }) => {
        if (!view) return;
        queryClient.setQueryData(
          trpc.kbShares.status.queryKey({ agentId }),
          view,
        );
      },
      meta: {
        invalidates: invalidatesShares,
        errorToast: "Couldn't update the public name",
      },
    }),
  );
}

export function useResolveKbShareLink() {
  return useMutation({
    ...trpc.kbShares.resolveLink.mutationOptions(),
    meta: { errorToast: "Couldn't check the share link" },
  });
}
