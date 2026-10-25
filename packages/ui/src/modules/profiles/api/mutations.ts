import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";

/** UNIT_BOUNDARY_DESCRIPTION: a rename reaches no agent; a delete is refused while something points at the profile, which the server says in its own words. */
export function useUpdateProfile() {
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      harness?: string;
      providerTemplate?: string;
      model?: string;
      settings?: Record<string, string>;
    }) => api.profiles.update.mutate(input),
    meta: { invalidates: [trpc.profiles.list.queryKey()] },
  });
}

export function useDeleteProfile() {
  return useMutation({
    mutationFn: (input: { id: string }) => api.profiles.delete.mutate(input),
    meta: { invalidates: [trpc.profiles.list.queryKey()] },
  });
}

/** UNIT_BOUNDARY_DESCRIPTION: the profile a picker creates from the choices it holds; it becomes the selection in the slot the user was in. */
export function useCreateProfile() {
  return useMutation({
    mutationFn: (input: {
      name: string;
      harness: string;
      providerTemplate: string;
      model: string;
      settings?: Record<string, string>;
    }) => api.profiles.create.mutate(input),
    meta: { invalidates: [trpc.profiles.list.queryKey()] },
  });
}
