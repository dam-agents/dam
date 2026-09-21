import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const invalidates = [trpc.satellites.list.queryKey()];

export function useGrantSatellite() {
  return useMutation({
    ...trpc.satellites.grant.mutationOptions(),
    meta: { invalidates, errorToast: "Couldn't grant the satellite" },
  });
}

export function useRevokeSatellite() {
  return useMutation({
    ...trpc.satellites.revoke.mutationOptions(),
    meta: { invalidates, errorToast: "Couldn't revoke the satellite" },
  });
}

export function useRemoveSatellite() {
  return useMutation({
    ...trpc.satellites.remove.mutationOptions(),
    meta: { invalidates, errorToast: "Couldn't remove the satellite" },
  });
}
