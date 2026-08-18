import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const invalidatesLibrary = [
  trpc.artifactLibrary.list.queryKey(),
  trpc.artifactLibrary.listFolders.queryKey(),
];
const invalidatesLibraryAndContent = [
  ...invalidatesLibrary,
  trpc.artifactLibrary.get.queryKey(),
  trpc.artifactLibrary.getContent.queryKey(),
  trpc.artifactLibrary.preview.queryKey(),
];

export function useCreateArtifact() {
  return useMutation({
    ...trpc.artifactLibrary.create.mutationOptions(),
    meta: {
      invalidates: invalidatesLibrary,
      errorToast: "Failed to create artifact",
    },
  });
}

export function useUpdateArtifact() {
  return useMutation({
    ...trpc.artifactLibrary.update.mutationOptions(),
    meta: {
      invalidates: invalidatesLibraryAndContent,
      errorToast: "Failed to update artifact",
    },
  });
}

export function useSetArtifactSharing() {
  return useMutation({
    ...trpc.artifactLibrary.setSharing.mutationOptions(),
    meta: {
      invalidates: invalidatesLibrary,
      errorToast: "Failed to update sharing",
    },
  });
}

export function useDeleteArtifact() {
  return useMutation({
    ...trpc.artifactLibrary.delete.mutationOptions(),
    meta: {
      invalidates: invalidatesLibrary,
      errorToast: "Failed to delete artifact",
    },
  });
}

export function useCreateFolder() {
  return useMutation({
    ...trpc.artifactLibrary.createFolder.mutationOptions(),
    meta: {
      invalidates: [trpc.artifactLibrary.listFolders.queryKey()],
      errorToast: "Failed to create folder",
    },
  });
}

export function useUpdateFolder() {
  return useMutation({
    ...trpc.artifactLibrary.updateFolder.mutationOptions(),
    meta: {
      invalidates: invalidatesLibrary,
      errorToast: "Failed to update folder",
    },
  });
}

export function useDeleteFolder() {
  return useMutation({
    ...trpc.artifactLibrary.deleteFolder.mutationOptions(),
    meta: {
      invalidates: invalidatesLibrary,
      errorToast: "Failed to delete folder",
    },
  });
}
