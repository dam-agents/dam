import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const meta = { invalidates: [trpc.profiles.list.queryKey()] };

export const useCreateProfile = () =>
  useMutation({ ...trpc.profiles.create.mutationOptions(), meta });

export const useUpdateProfile = () =>
  useMutation({ ...trpc.profiles.update.mutationOptions(), meta });

export const useDeleteProfile = () =>
  useMutation({ ...trpc.profiles.delete.mutationOptions(), meta });

export const useSetDefaultProfile = () =>
  useMutation({ ...trpc.profiles.setDefault.mutationOptions(), meta });
