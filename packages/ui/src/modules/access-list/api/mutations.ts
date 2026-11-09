import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useAddToAccessList() {
  return useMutation({
    ...trpc.accessList.add.mutationOptions(),
    meta: {
      invalidates: [trpc.accessList.list.queryKey()],
      errorToast: "Couldn't add to the access list",
    },
  });
}

export function useRemoveFromAccessList() {
  return useMutation({
    ...trpc.accessList.remove.mutationOptions(),
    meta: {
      invalidates: [trpc.accessList.list.queryKey()],
      errorToast: "Couldn't remove from the access list",
    },
  });
}
