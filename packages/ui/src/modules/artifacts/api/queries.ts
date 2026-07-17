import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { trpc } from "../../../trpc.js";

export interface ArtifactListFilter {
  folderId?: string | null;
  agentId?: string;
  search?: string;
}

/** Artifact list — refresh-on-open like experiments; agents publish in the
 *  background, so a fresh read on mount matters more than a live feed.
 *  Pass `null` to hold the query (e.g. no agent resolved yet); pass
 *  `refetchIntervalMs` where the list must track live publishing (the chat
 *  sidebar). */
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

/** Single artifact by id. Polls when `refetchIntervalMs` is set (the docked
 *  chat preview uses this so a freshly published version swaps in live). */
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

/** Full version history (ascending), current version last. Polls alongside
 *  the docked panel so a freshly published version extends the switcher. */
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

/** Fresh-enough window that a hover-prefetched preview is served from cache
 *  when the dialog mounts instead of refetching mid-animation. Mutations
 *  that publish a new version invalidate it explicitly. */
const PREVIEW_STALE_MS = 30_000;

/** Rendered preview document for the sandboxed iframe — same inner document
 *  the share page serves. null when the artifact isn't renderable. */
export function useArtifactPreview(id: string | null, version?: number) {
  return useQuery({
    ...trpc.artifactLibrary.preview.queryOptions(
      id ? { id, version } : skipToken,
    ),
    staleTime: PREVIEW_STALE_MS,
    meta: { errorToast: "Couldn't render artifact preview" },
  });
}

/** Warm the preview cache before the dialog opens (call on row hover/focus)
 *  so opening animates over already-loaded content. */
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
