import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { createInstanceTrpc } from "../../instances/instance-trpc.js";

export const fileKeys = {
  root: (instanceId: string) => ["files", instanceId] as const,
  tree: (instanceId: string) => [...fileKeys.root(instanceId), "tree"] as const,
  content: (instanceId: string, path: string) =>
    [...fileKeys.root(instanceId), "content", path] as const,
};

// Per-instance tRPC clients are cheap but creating a new one per refetch is
// wasteful churn. Cache by instanceId so each polled query reuses the same
// client for its lifetime.
const clientCache = new Map<string, ReturnType<typeof createInstanceTrpc>>();
function getInstanceTrpc(instanceId: string) {
  let client = clientCache.get(instanceId);
  if (!client) {
    client = createInstanceTrpc(instanceId);
    clientCache.set(instanceId, client);
  }
  return client;
}

interface FileContent {
  path: string;
  content: string;
  binary?: boolean;
  mimeType?: string;
  mtimeMs?: number;
}

export function useFileTreeQuery(instanceId: string | null) {
  return useQuery({
    queryKey: fileKeys.tree(instanceId ?? "_none"),
    queryFn: async () => {
      const trpc = getInstanceTrpc(instanceId!);
      const result = await trpc.files.tree.query();
      return result.entries;
    },
    enabled: !!instanceId,
    refetchInterval: 2000,
    staleTime: 2000,
    meta: { errorToast: "Couldn't refresh file tree" },
  });
}

export function useFileContentQuery(
  instanceId: string | null,
  path: string | null,
) {
  return useQuery({
    queryKey: fileKeys.content(instanceId ?? "_none", path ?? "_none"),
    queryFn: async () => {
      const trpc = getInstanceTrpc(instanceId!);
      const result = await trpc.files.read.query({ path: path! });
      return {
        path: result.path,
        content: result.content ?? "",
        binary: result.binary,
        mimeType: result.mimeType,
        mtimeMs: result.mtimeMs,
      } satisfies FileContent;
    },
    enabled: !!instanceId && !!path,
    refetchInterval: 2000,
    staleTime: 2000,
    retry: 0,
  });
}

/**
 * Imperative fetch for user-initiated file opens. Goes through the query
 * cache so the subsequent useFileContentQuery subscription reuses the result
 * instead of refetching.
 */
export async function fetchFileContent(
  instanceId: string,
  path: string,
): Promise<FileContent> {
  return queryClient.fetchQuery({
    queryKey: fileKeys.content(instanceId, path),
    queryFn: async () => {
      const trpc = getInstanceTrpc(instanceId);
      const result = await trpc.files.read.query({ path });
      return {
        path: result.path,
        content: result.content ?? "",
        binary: result.binary,
        mimeType: result.mimeType,
        mtimeMs: result.mtimeMs,
      };
    },
  });
}

function invalidateFiles(
  qc: ReturnType<typeof useQueryClient>,
  instanceId: string,
  path?: string,
) {
  qc.invalidateQueries({ queryKey: fileKeys.tree(instanceId) });
  if (path)
    qc.invalidateQueries({ queryKey: fileKeys.content(instanceId, path) });
}

export function useFileWriteMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      path: string;
      content: string;
      expectedMtimeMs?: number;
    }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.write.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (instanceId) invalidateFiles(qc, instanceId, vars.path);
    },
  });
}

export function useFileCreateMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { path: string; content?: string }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.create.mutate({
        path: input.path,
        content: input.content ?? "",
      });
    },
    onSuccess: (_data, vars) => {
      if (instanceId) invalidateFiles(qc, instanceId, vars.path);
    },
  });
}

export function useFolderCreateMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { path: string }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.mkdir.mutate(input);
    },
    onSuccess: () => {
      if (instanceId) invalidateFiles(qc, instanceId);
    },
  });
}

export function useFileRenameMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      from: string;
      to: string;
      overwrite?: boolean;
    }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.rename.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (instanceId) {
        invalidateFiles(qc, instanceId, vars.from);
        qc.invalidateQueries({
          queryKey: fileKeys.content(instanceId, vars.to),
        });
      }
    },
  });
}

export function useFileDeleteMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { path: string }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.remove.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (instanceId) invalidateFiles(qc, instanceId, vars.path);
    },
  });
}

/** Mirrors the MAX_FILE_SIZE cap in agent-runtime/src/modules/files.ts.
 *  Exported so callers (tree-panel upload button, chat composer) can reject
 *  oversized files before sending and surface a consistent message. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MESSAGE_UPLOAD_ROOT = ".uploads";

function sanitizeSegment(s: string): string {
  // Strip path separators, leading dots, and anything that'd make the server
  // reject the segment. Keep a conservative allowlist.
  return s.replace(/[^A-Za-z0-9._\-]+/g, "_").replace(/^\.+/, "") || "file";
}

/**
 * Persists a chat-message attachment into the agent pod so the agent can
 * read it by path (`file:///home/agent/.uploads/<sessionId>/<unique>-<name>`).
 * Returns the on-pod absolute path the caller should put into the ACP
 * `resource_link` URI.
 */
export async function uploadMessageAttachment(
  instanceId: string,
  sessionId: string,
  attachment: { name: string; data: string; mimeType: string },
): Promise<{ absolutePath: string; relPath: string }> {
  const trpc = getInstanceTrpc(instanceId);
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
  // Fallback in case a future server forgets to surface absolutePath — keep
  // the UI functional, but the canonical path comes from the server.
  const absolutePath = res.absolutePath ?? `/home/agent/${relPath}`;
  return { absolutePath, relPath };
}

export function useFileUploadMutation(instanceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      path: string;
      contentBase64: string;
      contentType?: string;
      overwrite?: boolean;
    }) => {
      const trpc = getInstanceTrpc(instanceId!);
      return trpc.files.upload.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (instanceId) invalidateFiles(qc, instanceId, vars.path);
    },
  });
}
