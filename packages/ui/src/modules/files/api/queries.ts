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
import { createAgentTrpc } from "../../agents/agent-trpc.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { fileKeys } from "./keys.js";

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();

// Per-agent tRPC clients are cheap but creating a new one per refetch is
// wasteful churn. Cache by agentId so each polled query reuses the same
// client for its lifetime.
const clientCache = new Map<string, ReturnType<typeof createAgentTrpc>>();
function getAgentTrpc(agentId: string) {
  let client = clientCache.get(agentId);
  if (!client) {
    client = createAgentTrpc(agentId);
    clientCache.set(agentId, client);
  }
  return client;
}

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

/** Sorted, deduped paths to fetch. The sort makes the query key stable
 *  across renders so React Query treats `{a, b}` and `{b, a}` as the same
 *  entry instead of churning two cache rows. */
function paramsForExpanded(expanded: ReadonlySet<string>): string[] {
  return ["", ...expanded].sort();
}

/** Subscribe to one directory's slice of the batched poll. The sorted paths
 *  set is part of the key, so an expand/collapse swaps to a new
 *  entry and React Query refetches without any explicit invalidation. Returns null
 *  until the slice is present; null is the right answer for "the user just
 *  expanded this dir and the next poll hasn't arrived yet". */
const MOCK_FILE_TREE: ListDirsResponse = {
  results: [
    {
      path: "",
      ok: true,
      entries: [
        { name: "src", type: "dir" },
        { name: "tests", type: "dir" },
        { name: "scripts", type: "dir" },
        { name: "package.json", type: "file" },
        { name: "tsconfig.json", type: "file" },
        { name: "docker-compose.yml", type: "file" },
        { name: "Dockerfile", type: "file" },
        { name: ".env.example", type: "file" },
        { name: "README.md", type: "file" },
      ],
    },
    {
      path: "src",
      ok: true,
      entries: [
        { name: "routes", type: "dir" },
        { name: "middleware", type: "dir" },
        { name: "services", type: "dir" },
        { name: "models", type: "dir" },
        { name: "lib", type: "dir" },
        { name: "config", type: "dir" },
        { name: "index.ts", type: "file" },
        { name: "app.ts", type: "file" },
        { name: "server.ts", type: "file" },
      ],
    },
    {
      path: "src/routes",
      ok: true,
      entries: [
        { name: "auth.ts", type: "file" },
        { name: "users.ts", type: "file" },
        { name: "projects.ts", type: "file" },
        { name: "webhooks.ts", type: "file" },
        { name: "health.ts", type: "file" },
      ],
    },
    {
      path: "src/middleware",
      ok: true,
      entries: [
        { name: "auth.ts", type: "file" },
        { name: "rate-limit.ts", type: "file" },
        { name: "validate.ts", type: "file" },
        { name: "error-handler.ts", type: "file" },
        { name: "logger.ts", type: "file" },
      ],
    },
    {
      path: "src/services",
      ok: true,
      entries: [
        { name: "auth.service.ts", type: "file" },
        { name: "user.service.ts", type: "file" },
        { name: "project.service.ts", type: "file" },
        { name: "email.service.ts", type: "file" },
        { name: "storage.service.ts", type: "file" },
      ],
    },
    {
      path: "src/models",
      ok: true,
      entries: [
        { name: "user.ts", type: "file" },
        { name: "project.ts", type: "file" },
        { name: "session.ts", type: "file" },
        { name: "audit-log.ts", type: "file" },
      ],
    },
    {
      path: "src/lib",
      ok: true,
      entries: [
        { name: "db.ts", type: "file" },
        { name: "redis.ts", type: "file" },
        { name: "jwt.ts", type: "file" },
        { name: "crypto.ts", type: "file" },
        { name: "queue.ts", type: "file" },
      ],
    },
    {
      path: "src/config",
      ok: true,
      entries: [
        { name: "index.ts", type: "file" },
        { name: "database.ts", type: "file" },
        { name: "auth.ts", type: "file" },
      ],
    },
    {
      path: "tests",
      ok: true,
      entries: [
        { name: "unit", type: "dir" },
        { name: "integration", type: "dir" },
        { name: "setup.ts", type: "file" },
      ],
    },
    {
      path: "tests/unit",
      ok: true,
      entries: [
        { name: "auth.service.test.ts", type: "file" },
        { name: "user.service.test.ts", type: "file" },
        { name: "jwt.test.ts", type: "file" },
      ],
    },
    {
      path: "tests/integration",
      ok: true,
      entries: [
        { name: "auth.test.ts", type: "file" },
        { name: "projects.test.ts", type: "file" },
      ],
    },
    {
      path: "scripts",
      ok: true,
      entries: [
        { name: "migrate.ts", type: "file" },
        { name: "seed.ts", type: "file" },
      ],
    },
  ],
};

export function useDirSnapshot(agentId: string | null, path: string) {
  const expanded = useExpandedDirs(agentId);
  const paths = paramsForExpanded(expanded);
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: fileKeys.treeForPaths(agentId ?? "_none", paths),
    queryFn: async (): Promise<ListDirsResponse> => {
      if (!operable) return MOCK_FILE_TREE;
      const trpc = getAgentTrpc(agentId!);
      return trpc.files.listDirs.query({ paths });
    },
    enabled: !!agentId,
    refetchInterval: operable ? 2000 : false,
    staleTime: operable ? 2000 : Infinity,
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
    // No retry — transient errors resolve on the next 2 s poll tick, and we
    // don't want React Query to mask NOT_FOUND with a delayed close-on-error.
    retry: 0,
  });
}

async function readFileContent(
  agentId: string,
  path: string,
): Promise<FileContent> {
  const trpc = getAgentTrpc(agentId);
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
    // Convert the transport-layer "too large" error back into a typed
    // placeholder so the viewer can render its "file too large" state.
    // The query-cache close-on-error path is reserved for genuinely
    // gone files (rename, delete, NOT_FOUND).
    if (e instanceof TRPCClientError && e.data?.code === "PAYLOAD_TOO_LARGE") {
      return { path, content: "", binary: true, tooLarge: true };
    }
    throw e;
  }
}

/**
 * Imperative fetch for user-initiated file opens. Goes through the query
 * cache so the subsequent useFileContentQuery subscription reuses the result
 * instead of refetching.
 */
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
    mutationFn: async (input: {
      path: string;
      content: string;
      expectedMtimeMs?: number;
    }) => {
      const trpc = getAgentTrpc(agentId!);
      return trpc.files.write.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (agentId) invalidateFiles(qc, agentId, vars.path);
    },
  });
}

function addEntryToCache(
  qc: ReturnType<typeof useQueryClient>,
  agentId: string,
  path: string,
  type: "file" | "dir",
) {
  const dir =
    path.lastIndexOf("/") >= 0 ? path.slice(0, path.lastIndexOf("/")) : "";
  const name =
    path.lastIndexOf("/") >= 0 ? path.slice(path.lastIndexOf("/") + 1) : path;
  qc.setQueriesData<ListDirsResponse>(
    { queryKey: fileKeys.tree(agentId) },
    (old) => {
      if (!old) return old;
      return {
        results: old.results.map((r) => {
          if (r.path !== dir || !r.ok) return r;
          return { ...r, entries: [...r.entries, { name, type }] };
        }),
      };
    },
  );
}

function removeEntryFromCache(
  qc: ReturnType<typeof useQueryClient>,
  agentId: string,
  path: string,
) {
  const dir =
    path.lastIndexOf("/") >= 0 ? path.slice(0, path.lastIndexOf("/")) : "";
  const name =
    path.lastIndexOf("/") >= 0 ? path.slice(path.lastIndexOf("/") + 1) : path;
  qc.setQueriesData<ListDirsResponse>(
    { queryKey: fileKeys.tree(agentId) },
    (old) => {
      if (!old) return old;
      return {
        results: old.results.map((r) => {
          if (r.path !== dir || !r.ok) return r;
          return {
            ...r,
            entries: r.entries.filter((e: { name: string }) => e.name !== name),
          };
        }),
      };
    },
  );
}

export function useFileCreateMutation(agentId: string | null) {
  const qc = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  return useMutation({
    mutationFn: async (input: { path: string; content?: string }) => {
      if (!operable) {
        if (agentId) addEntryToCache(qc, agentId, input.path, "file");
        return { path: input.path };
      }
      const trpc = getAgentTrpc(agentId!);
      return trpc.files.create.mutate({
        path: input.path,
        content: input.content ?? "",
      });
    },
    onSuccess: (_data, vars) => {
      if (agentId && operable) invalidateFiles(qc, agentId, vars.path);
    },
  });
}

export function useFolderCreateMutation(agentId: string | null) {
  const qc = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  return useMutation({
    mutationFn: async (input: { path: string }) => {
      if (!operable) {
        if (agentId) addEntryToCache(qc, agentId, input.path, "dir");
        return { path: input.path };
      }
      const trpc = getAgentTrpc(agentId!);
      return trpc.files.mkdir.mutate(input);
    },
    onSuccess: () => {
      if (agentId && operable) invalidateFiles(qc, agentId);
    },
  });
}

export function useFileRenameMutation(agentId: string | null) {
  const qc = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  return useMutation({
    mutationFn: async (input: {
      from: string;
      to: string;
      overwrite?: boolean;
    }) => {
      if (!operable) {
        if (agentId) {
          removeEntryFromCache(qc, agentId, input.from);
          const isDir = input.from.includes("/") ? false : true;
          addEntryToCache(qc, agentId, input.to, isDir ? "dir" : "file");
        }
        return { from: input.from, to: input.to };
      }
      const trpc = getAgentTrpc(agentId!);
      return trpc.files.rename.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (agentId && operable) {
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
  const operable = useIsAgentOperable(agentId);
  return useMutation({
    mutationFn: async (input: { path: string }) => {
      if (!operable) {
        if (agentId) removeEntryFromCache(qc, agentId, input.path);
        return { path: input.path };
      }
      const trpc = getAgentTrpc(agentId!);
      return trpc.files.remove.mutate(input);
    },
    onSuccess: (_data, vars) => {
      if (agentId && operable) invalidateFiles(qc, agentId, vars.path);
    },
  });
}

// Client-side pre-flight cap so oversized uploads fail in the UI before
// hitting the wire. Server-side enforcement lives in agent-runtime and
// surfaces as PAYLOAD_TOO_LARGE — this value can drift up to but not past it.
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
  agentId: string,
  sessionId: string,
  attachment: { name: string; data: string; mimeType: string },
): Promise<{ absolutePath: string; relPath: string }> {
  const trpc = getAgentTrpc(agentId);
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

export function useFileUploadMutation(agentId: string | null) {
  const qc = useQueryClient();
  const operable = useIsAgentOperable(agentId);
  return useMutation({
    mutationFn: async (input: {
      path: string;
      contentBase64: string;
      contentType?: string;
      overwrite?: boolean;
    }) => {
      if (!operable) {
        if (agentId) addEntryToCache(qc, agentId, input.path, "file");
        return { path: input.path };
      }
      return api.files.upload.mutate({ agentId: agentId!, ...input });
    },
    onSuccess: (_data, vars) => {
      if (agentId && operable) invalidateFiles(qc, agentId, vars.path);
    },
  });
}
