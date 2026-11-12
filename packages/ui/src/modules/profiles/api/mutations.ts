import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const meta = { invalidates: [trpc.profiles.list.queryKey()] };

export const useCreateProfile = () =>
  useMutation({ ...trpc.profiles.create.mutationOptions(), meta });

export const useUpdateProfile = (opts?: { silent?: boolean }) =>
  useMutation({
    ...trpc.profiles.update.mutationOptions(),
    meta: { ...meta, suppressErrorToast: opts?.silent },
  });

export const useDeleteProfile = () =>
  useMutation({
    ...trpc.profiles.delete.mutationOptions(),
    /* UNIT_BOUNDARY_DESCRIPTION: deleting the profile picked as the default for new agents takes that pick with it. */
    meta: {
      invalidates: [
        ...meta.invalidates,
        trpc.profiles.newAgentDefault.queryKey(),
      ],
    },
  });

export const useSetNewAgentDefault = () =>
  useMutation({
    ...trpc.profiles.setNewAgentDefault.mutationOptions(),
    meta: { invalidates: [trpc.profiles.newAgentDefault.queryKey()] },
  });
