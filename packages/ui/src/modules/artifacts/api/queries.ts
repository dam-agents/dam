import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { trpc } from "../../../trpc.js";

export interface ArtifactListFilter {
  folderId?: string | null;
  agentId?: string;
  search?: string;
}

export function useArtifacts(
  filter?: ArtifactListFilter | null,
  opts?: { refetchIntervalMs?: number },
) {
  return useQuery({
    ...trpc.artifactLibrary.list.queryOptions(
      filter === null ? skipToken : (filter ?? {}),
    ),
    refetchOnMount: "always",
    staleTime: 0,
    ...(opts?.refetchIntervalMs
      ? { refetchInterval: opts.refetchIntervalMs }
      : {}),
    meta: { errorToast: "Couldn't load artifacts" },
  });
}

export function useArtifact(
  id: string | null,
  opts?: { refetchIntervalMs?: number },
) {
  return useQuery({
    ...trpc.artifactLibrary.get.queryOptions(id ? { id } : skipToken),
    retry: false,
    ...(opts?.refetchIntervalMs
      ? { refetchInterval: opts.refetchIntervalMs }
      : {}),
    meta: { errorToast: "Couldn't load artifact" },
  });
}

export function useArtifactFolders() {
  return useQuery({
    ...trpc.artifactLibrary.listFolders.queryOptions(),
    refetchOnMount: "always",
    staleTime: 0,
    meta: { errorToast: "Couldn't load folders" },
  });
}

export function useArtifactVersions(
  id: string | null,
  opts?: { refetchIntervalMs?: number },
) {
  return useQuery({
    ...trpc.artifactLibrary.listVersions.queryOptions(id ? { id } : skipToken),
    ...(opts?.refetchIntervalMs
      ? { refetchInterval: opts.refetchIntervalMs }
      : {}),
    meta: { errorToast: "Couldn't load version history" },
  });
}

export function useArtifactContent(id: string | null, version?: number) {
  return useQuery({
    ...trpc.artifactLibrary.getContent.queryOptions(
      id ? { id, version } : skipToken,
    ),
    meta: { errorToast: "Couldn't load artifact content" },
  });
}

const PREVIEW_STALE_MS = 30_000;

export function useArtifactPreview(id: string | null, version?: number) {
  return useQuery({
    ...trpc.artifactLibrary.preview.queryOptions(
      id ? { id, version } : skipToken,
    ),
    staleTime: PREVIEW_STALE_MS,
    meta: { errorToast: "Couldn't render artifact preview" },
  });
}

export function usePrefetchArtifactPreview() {
  const queryClient = useQueryClient();
  return useCallback(
    (id: string) => {
      void queryClient.prefetchQuery({
        ...trpc.artifactLibrary.preview.queryOptions({ id }),
        staleTime: PREVIEW_STALE_MS,
      });
    },
    [queryClient],
  );
}

export function useFolderShareUrl(id: string | null) {
  return useQuery({
    ...trpc.artifactLibrary.folderShareUrl.queryOptions(
      id ? { id } : skipToken,
    ),
    meta: { errorToast: "Couldn't resolve folder link" },
  });
}
