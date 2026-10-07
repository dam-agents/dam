import { TRPCClientError } from "@trpc/client";
import {
  type BrowserSnapshot,
  browserSnapshotSchema,
  type PageState,
} from "agent-runtime-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { watchWithRetry } from "../../../lib/watch-retry.js";
import { agentTrpc } from "../../agents/agent-trpc.js";

const ERROR_SHOWN_MS = 6_000;

export type BrowserConnection =
  "connecting" | "live" | "disconnected" | "unavailable";

const NO_PAGE: PageState = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
};

const refused = (error: unknown) =>
  error instanceof TRPCClientError &&
  (error.data?.code === "FORBIDDEN" ||
    error.data?.code === "PRECONDITION_FAILED");

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type Client = ReturnType<typeof agentTrpc>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the browser panel's control of the agent's
 * browser, over the agent's tRPC. Watching keeps the browser running while the
 * panel is open and reports its state and page; the toolbar's actions are
 * mutations. An address asked for before the watch is live is sent once it
 * is, as the agent may still be waking. `connects` counts each time the watch
 * goes live, which the stream page uses to check its token. An agent that does
 * not offer the panel is told apart from one that cannot be reached, and is
 * not retried.
 */
export function useBrowserControl(agentId: string) {
  const [connection, setConnection] = useState<BrowserConnection>("connecting");
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>({
    state: "starting",
    message: null,
    page: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [watchKey, setWatchKey] = useState(0);
  const [connects, setConnects] = useState(0);
  const live = useRef(false);
  const pendingUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const run = useCallback(
    (call: (client: Client) => Promise<unknown>) => {
      setError(null);
      call(agentTrpc(agentId)).catch((e: unknown) => setError(messageOf(e)));
    },
    [agentId],
  );

  const navigate = useCallback(
    (url: string) => {
      setSnapshot((s) => ({
        ...s,
        page: { ...(s.page ?? NO_PAGE), url, loading: true },
      }));
      if (!live.current) {
        pendingUrl.current = url;
        return;
      }
      run((client) => client.browser.navigate.mutate({ url }));
    },
    [run],
  );

  useEffect(() => {
    live.current = false;
    setConnection("connecting");
    return watchWithRetry((onError) => {
      let started = false;
      return agentTrpc(agentId).browser.watch.subscribe(undefined, {
        onData: (data) => {
          const parsed = browserSnapshotSchema.safeParse(data);
          if (!parsed.success) return;
          if (!started) {
            started = true;
            live.current = true;
            setConnection("live");
            setConnects((n) => n + 1);
            const url = pendingUrl.current;
            pendingUrl.current = null;
            if (url) run((client) => client.browser.navigate.mutate({ url }));
          }
          setSnapshot(parsed.data);
        },
        onError: (e) => {
          live.current = false;
          if (refused(e)) {
            setConnection("unavailable");
            setError(messageOf(e));
            return;
          }
          setConnection("disconnected");
          onError(e);
        },
      });
    });
  }, [agentId, watchKey, run]);

  return {
    connection,
    connects,
    browser: { state: snapshot.state, message: snapshot.message },
    page: snapshot.page ?? NO_PAGE,
    error,
    navigate,
    reload: () => run((client) => client.browser.reload.mutate()),
    stop: () => run((client) => client.browser.stop.mutate()),
    back: () => run((client) => client.browser.back.mutate()),
    forward: () => run((client) => client.browser.forward.mutate()),
    clearData: () => run((client) => client.browser.clearData.mutate()),
    restartBrowser: () => run((client) => client.browser.restart.mutate()),
    reconnect: () => setWatchKey((k) => k + 1),
  };
}
