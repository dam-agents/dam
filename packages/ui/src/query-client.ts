import { type Query, QueryCache, QueryClient, type QueryKey } from "@tanstack/react-query";

import { emitToast } from "./lib/toast-sink.js";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      invalidates?: QueryKey[];
      errorToast?: string;
    };
    queryMeta: {
      errorToast?: string;
    };
  }
}

/** Cross-tab invalidation channel. When one tab mutates server state
 *  (creates/deletes a session, …) other tabs of the same origin should
 *  refetch their corresponding lists immediately rather than waiting for
 *  staleTime / refetchOnWindowFocus. The channel carries QueryKeys; on
 *  receipt each listener invalidates its local cache. Falls back to a
 *  no-op on browsers without BroadcastChannel (Safari < 15.4, etc.).
 *
 *  Scope: **same browser, same origin only.** BroadcastChannel does not
 *  cross browsers (Chrome ↔ Safari) or processes. Multi-user / multi-
 *  browser sync (e.g. the multiplayer-mode workstream where two users
 *  view the same agent's session list) needs a server-side push channel
 *  — likely SSE or a list-scoped WS off api-server, fed by Redis pub/sub
 *  on session create/update/delete. Not on this plan; see
 *  docs/plans/session-resilience.md "Deferred / future work". */
const CROSS_TAB_CHANNEL = "platform-cross-tab";
type CrossTabMessage = { kind: "invalidate-queries"; keys: QueryKey[] };
const crossTabChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CROSS_TAB_CHANNEL) : null;

// One toast per sustained outage, cleared on the next success. Without this a
// 5-second poll would emit a toast every tick while the backend is down.
const notifiedOutages = new WeakSet<Query<unknown, unknown, unknown>>();

const queryCache = new QueryCache({
  onSuccess: (_data, query) => {
    notifiedOutages.delete(query);
  },
  onError: (_error, query) => {
    const toast = query.meta?.errorToast;
    if (!toast || notifiedOutages.has(query)) return;
    notifiedOutages.add(query);
    emitToast({ kind: "warning", message: toast });
  },
});

export const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      retry: 3,
      staleTime: 30_000,
    },
    mutations: {
      onSuccess: (_data, _vars, _ctx, mutation) => {
        const keys = mutation.meta?.invalidates;
        if (!keys?.length) return;
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        // Mirror to other tabs of the same origin — without this they keep
        // showing stale lists until window-focus or staleTime expiry.
        crossTabChannel?.postMessage({ kind: "invalidate-queries", keys } satisfies CrossTabMessage);
      },
      onError: (error, _vars, _ctx, mutation) => {
        const title = mutation.meta?.errorToast;
        const detail = error instanceof Error && error.message ? error.message : "";
        const message =
          title && detail
            ? `${title}: ${detail}`
            : title || detail || "Action failed";
        emitToast({ kind: "error", message });
      },
    },
  },
});

/**
 * Invalidate one or more query keys locally and broadcast the same to other
 * tabs of the same origin. Use for code paths that don't go through a
 * tRPC `mutation.meta.invalidates` (direct `api.x.mutate()` calls,
 * imperative refresh after side-effects).
 */
export function invalidateAcrossTabs(keys: QueryKey[]): void {
  for (const key of keys) {
    queryClient.invalidateQueries({ queryKey: key });
  }
  crossTabChannel?.postMessage({ kind: "invalidate-queries", keys } satisfies CrossTabMessage);
}

crossTabChannel?.addEventListener("message", (e) => {
  const data = e.data as CrossTabMessage | undefined;
  if (!data || data.kind !== "invalidate-queries") return;
  for (const key of data.keys) {
    queryClient.invalidateQueries({ queryKey: key });
  }
});
