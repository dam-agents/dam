import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useGrantSatellite() {
  return useMutation({
    ...trpc.satellites.grant.mutationOptions(),
    meta: {
      invalidates: [trpc.satellites.list.queryKey()],
      errorToast: "Couldn't add the satellite to this agent",
    },
  });
}

export function useRevokeSatellite() {
  return useMutation({
    ...trpc.satellites.revoke.mutationOptions(),
    meta: {
      invalidates: [trpc.satellites.list.queryKey()],
      errorToast: "Couldn't remove the satellite from this agent",
    },
  });
}

export function useRemoveSatellite() {
  return useMutation({
    ...trpc.satellites.remove.mutationOptions(),
    meta: {
      invalidates: [trpc.satellites.list.queryKey()],
      errorToast: "Couldn't remove the satellite",
    },
  });
}
