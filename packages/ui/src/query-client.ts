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
        mutation.meta?.invalidates?.forEach((key) =>
          queryClient.invalidateQueries({ queryKey: key }),
        );
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
