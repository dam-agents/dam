import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { DirListResult } from "agent-runtime-api";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { fileKeys } from "./keys.js";

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();

export interface FileContent {
  path: string;
  content: string;
  binary?: boolean;
  mimeType?: string;
  mtimeMs?: number;
  tooLarge?: boolean;
}

interface ListDirsResponse {
  results: DirListResult[];
}

function useExpandedDirs(agentId: string | null): ReadonlySet<string> {
  return useStore((s) =>
    agentId ? (s.expandedDirs[agentId] ?? EMPTY_EXPANDED) : EMPTY_EXPANDED,
  );
}

function paramsForExpanded(expanded: ReadonlySet<string>): string[] {
  return ["", ...expanded].sort();
}

export function useDirSnapshot(agentId: string | null, path: string) {
  const expanded = useExpandedDirs(agentId);
  const paths = paramsForExpanded(expanded);
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: fileKeys.treeForPaths(agentId ?? "_none", paths),
    queryFn: async (): Promise<ListDirsResponse> => {
      const trpc = agentTrpc(agentId!);
      return trpc.files.listDirs.query({ paths });
    },
    enabled: !!agentId && operable,
    refetchInterval: 2000,
    staleTime: 2000,
    placeholderData: keepPreviousData,
    select: (data) => data.results.find((r) => r.path === path) ?? null,
    meta: { errorToast: "Couldn't refresh file tree" },
  });
}

export function useFileContentQuery(
  agentId: string | null,
  path: string | null,
) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: fileKeys.content(agentId ?? "_none", path ?? "_none"),
    queryFn: async () => readFileContent(agentId!, path!),
    enabled: !!agentId && !!path && operable,
    refetchInterval: 2000,
    staleTime: 2000,
    retry: 0,
  });
}

async function readFileContent(
  agentId: string,
  path: string,
): Promise<FileContent> {
  const trpc = agentTrpc(agentId);
  try {
    const result = await trpc.files.read.query({ path });
    return {
      path: result.path,
      content: result.content,
      binary: result.binary,
      mimeType: result.mimeType,
      mtimeMs: result.mtimeMs,
    };
  } catch (e) {
    if (e instanceof TRPCClientError && e.data?.code === "PAYLOAD_TOO_LARGE") {
      return { path, content: "", binary: true, tooLarge: true };
    }
    throw e;
  }
}

export async function fetchFileContent(
  agentId: string,
  path: string,
): Promise<FileContent> {
  return queryClient.fetchQuery({
    queryKey: fileKeys.content(agentId, path),
    queryFn: async () => readFileContent(agentId, path),
  });
}

function invalidateFiles(
  qc: ReturnType<typeof useQueryClient>,
  agentId: string,
  path?: string,
) {
  qc.invalidateQueries({ queryKey: fileKeys.tree(agentId) });
  if (path) qc.invalidateQueries({ queryKey: fileKeys.content(agentId, path) });
}

export function useFileWriteMutation(agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: async (input: {
      path: string;
      content: string;
      expectedMtimeMs?: number;
    }) => {
      const trpc = agentTrpc(agentId!);
      return trpc.files.write.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (agentId) invalidateFiles(qc, agentId, vars.path);
    },
  });
}

export function useFileCreateMutation(agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: async (input: { path: string; content?: string }) => {
      const trpc = agentTrpc(agentId!);
      return trpc.files.create.mutate({
        path: input.path,
        content: input.content ?? "",
      });
    },
    onSuccess: (_data, vars) => {
      if (agentId) invalidateFiles(qc, agentId, vars.path);
    },
  });
}

export function useFolderCreateMutation(agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: async (input: { path: string }) => {
      const trpc = agentTrpc(agentId!);
      return trpc.files.mkdir.mutate(input);
    },
    onSuccess: () => {
      if (agentId) invalidateFiles(qc, agentId);
    },
  });
}

export function useFileRenameMutation(agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: async (input: {
      from: string;
      to: string;
      overwrite?: boolean;
    }) => {
      const trpc = agentTrpc(agentId!);
      return trpc.files.rename.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (agentId) {
        invalidateFiles(qc, agentId, vars.from);
        qc.invalidateQueries({
          queryKey: fileKeys.content(agentId, vars.to),
        });
      }
    },
  });
}

export function useFileDeleteMutation(agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: async (input: { path: string }) => {
      const trpc = agentTrpc(agentId!);
      return trpc.files.remove.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (agentId) invalidateFiles(qc, agentId, vars.path);
    },
  });
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const MESSAGE_UPLOAD_ROOT = ".uploads";

function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._\-]+/g, "_").replace(/^\.+/, "") || "file";
}

export async function uploadMessageAttachment(
  agentId: string,
  sessionId: string,
  attachment: { name: string; data: string; mimeType: string },
): Promise<{ absolutePath: string; relPath: string }> {
  const trpc = agentTrpc(agentId);
  const sid = sanitizeSegment(sessionId);
  const safeName = sanitizeSegment(attachment.name || "file");
  const unique = crypto.randomUUID().slice(0, 8);
  const relPath = `${MESSAGE_UPLOAD_ROOT}/${sid}/${unique}-${safeName}`;
  const res = await trpc.files.upload.mutate({
    path: relPath,
    contentBase64: attachment.data,
    contentType: attachment.mimeType,
    overwrite: true,
  });
  const absolutePath = res.absolutePath ?? `/home/agent/${relPath}`;
  return { absolutePath, relPath };
}

export function useFileUploadMutation(agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (input: {
      path: string;
      contentBase64: string;
      contentType?: string;
      overwrite?: boolean;
    }) => api.files.upload.mutate({ agentId: agentId!, ...input }),
    onSuccess: (_data, vars) => {
      if (agentId) invalidateFiles(qc, agentId, vars.path);
    },
  });
}
