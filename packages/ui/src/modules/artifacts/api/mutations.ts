import { useMutation } from "@tanstack/react-query";
import type { LibraryArtifact } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

const invalidatesLibrary = [
  trpc.artifactLibrary.list.queryKey(),
  trpc.artifactLibrary.listFolders.queryKey(),
];
const invalidatesLibraryAndArtifact = [
  ...invalidatesLibrary,
  trpc.artifactLibrary.get.queryKey(),
];
const invalidatesLibraryAndContent = [
  ...invalidatesLibraryAndArtifact,
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
  const listKey = trpc.artifactLibrary.list.queryKey();
  return useMutation(
    trpc.artifactLibrary.update.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries({ queryKey: listKey });
        const snapshots = queryClient.getQueriesData<LibraryArtifact[]>({
          queryKey: listKey,
        });
        queryClient.setQueriesData<LibraryArtifact[]>(
          { queryKey: listKey },
          (rows) =>
            rows?.map((row) =>
              row.id === input.id
                ? {
                    ...row,
                    ...(input.title !== undefined
                      ? { title: input.title }
                      : {}),
                    ...(input.fileName !== undefined
                      ? { fileName: input.fileName }
                      : {}),
                    ...("folderId" in input
                      ? { folderId: input.folderId ?? null }
                      : {}),
                  }
                : row,
            ),
        );
        return { snapshots };
      },
      onSettled: (_data, error, _input, context) => {
        if (!error || !context) return;
        for (const [key, rows] of context.snapshots) {
          queryClient.setQueryData(key, rows);
        }
      },
      meta: {
        invalidates: invalidatesLibraryAndContent,
        errorToast: "Failed to update artifact",
      },
    }),
  );
}

export function useSetArtifactSharing() {
  return useMutation({
    ...trpc.artifactLibrary.setSharing.mutationOptions(),
    meta: {
      invalidates: invalidatesLibraryAndArtifact,
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
