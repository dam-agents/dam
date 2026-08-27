import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { trpc } from "../../../trpc.js";
import { listAgentSessions } from "../../sessions/api/acp-session-ops.js";

export interface ArtifactListFilter {
  folderId?: string | null;
  agentId?: string;
  search?: string;
}

export function useArtifacts(filter?: ArtifactListFilter | null) {
  return useQuery({
    ...trpc.artifactLibrary.list.queryOptions(
      filter === null ? skipToken : (filter ?? {}),
    ),
    refetchOnMount: "always",
    staleTime: 0,
    meta: { errorToast: "Couldn't load artifacts" },
  });
}

export function useArtifact(id: string | null) {
  return useQuery({
    ...trpc.artifactLibrary.get.queryOptions(id ? { id } : skipToken),
    retry: false,
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

export function useArtifactVersions(id: string | null) {
  return useQuery({
    ...trpc.artifactLibrary.listVersions.queryOptions(id ? { id } : skipToken),
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

export function useArtifactRequest(requestId: string | null) {
  return useQuery({
    ...trpc.artifactLibrary.requests.get.queryOptions(
      requestId ? { requestId } : skipToken,
    ),
    staleTime: 0,
    retry: 2,
  });
}

export function useArtifactSession(
  agentId: string | null,
  artifactId: string | null,
) {
  return useQuery({
    queryKey: ["artifact-session", agentId, artifactId] as const,
    queryFn:
      agentId && artifactId
        ? async () => {
            const sessions = await listAgentSessions(agentId);
            return sessions.find((s) => s.artifactId === artifactId) ?? null;
          }
        : skipToken,
    retry: 0,
    staleTime: 30_000,
  });
}
