import {
  onlineManager,
  type Query,
  QueryCache,
  QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { getApiHealthSnapshot, subscribeApiHealth } from "./lib/api-health.js";
import { getErrorMessage } from "./lib/errors.js";
import { refreshOnReturn } from "./lib/refresh-on-return.js";
import { emitToast } from "./lib/toast.js";
import { showStorageFull } from "./modules/budgets/lib/storage-full.js";
import {
  isTermsStale,
  isTermsStaleError,
  onTermsStale,
} from "./modules/terms/lib/on-terms-stale.js";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      invalidates?: QueryKey[];
      errorToast?: string;
      suppressErrorToast?: boolean;
    };
    queryMeta: {
      errorToast?: string;
    };
  }
}

const notifiedOutages = new WeakSet<Query<unknown, unknown, unknown>>();

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onSuccess: (_data, query) => {
      notifiedOutages.delete(query);
    },
    onError: (error, query) => {
      if (isTermsStaleError(error)) {
        onTermsStale();
        return;
      }
      const toast = query.meta?.errorToast;
      if (
        !toast ||
        notifiedOutages.has(query) ||
        getApiHealthSnapshot() === "reconnecting" ||
        isTermsStale()
      )
        return;
      notifiedOutages.add(query);
      emitToast({ kind: "warning", message: toast });
    },
  }),
  defaultOptions: {
    queries: {
      retry: 3,
      staleTime: 30_000,
      refetchOnWindowFocus: (query) => refreshOnReturn(query.queryKey, "focus"),
      refetchOnReconnect: (query) =>
        refreshOnReturn(query.queryKey, "reconnect"),
    },
    mutations: {
      onSuccess: (_data, _vars, _ctx, mutation): Promise<unknown> =>
        Promise.all(
          (mutation.meta?.invalidates ?? []).map((key) =>
            queryClient.invalidateQueries({ queryKey: key }),
          ),
        ),
      onError: (error, _vars, _ctx, mutation) => {
        if (isTermsStaleError(error)) {
          onTermsStale();
          return;
        }
        if (mutation.meta?.suppressErrorToast) return;
        if (showStorageFull(error)) return;
        if (getApiHealthSnapshot() === "reconnecting" || isTermsStale()) return;
        const title = mutation.meta?.errorToast;
        const detail = getErrorMessage(error, "");
        const message =
          title && detail
            ? `${title}: ${capitalised(detail)}`
            : title || capitalised(detail) || "Action failed";
        emitToast({ kind: "error", message });
      },
    },
  },
});

onlineManager.setEventListener((setOnline) =>
  subscribeApiHealth(() => {
    const connected = getApiHealthSnapshot() === "connected";
    setOnline(connected);
    if (connected) queryClient.invalidateQueries({ refetchType: "none" });
  }),
);

/* UNIT_BOUNDARY_DESCRIPTION: a server message is a sentence, so it reads as one
 * wherever the UI shows it — the API writes it in the lower case a log line
 * takes. */
const capitalised = (text: string): string =>
  text === "" ? "" : text[0]!.toUpperCase() + text.slice(1);
