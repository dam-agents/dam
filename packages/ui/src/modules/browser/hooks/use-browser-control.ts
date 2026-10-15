import { TRPCClientError } from "@trpc/client";
import {
  type BrowserSnapshot,
  browserSnapshotSchema,
  type PageState,
} from "agent-runtime-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { watchWithRetry } from "../../../lib/watch-retry.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import { createTabTarget } from "../lib/tab-target.js";
import { closeTabLocally, selectTabLocally } from "../lib/tabs.js";

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
 * mutations, and so is the testing mode switch; a runtime too old to have it
 * reports no mode. The browser's tabs come with its state, and the toolbar acts
 * on the tab the panel shows, named by its target id, so an agent bringing
 * another tab to the front meanwhile does not redirect it; a runtime too old
 * to report tabs reports none, and is sent no tab. A select or close shows at
 * once, and one the runtime refuses falls back to the tabs it last reported.
 * After a new tab, an address or toolbar action acts on the new tab, never on
 * the one shown before (tab-target). An address asked for before the watch is live is sent once it is, as
 * the agent may still be waking. `connects` counts each time the watch
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
  const reported = useRef<BrowserSnapshot | null>(null);
  const shownTab = useRef<string | undefined>(undefined);
  shownTab.current = (snapshot.tabs && snapshot.activeTab) || undefined;
  const [tabTarget] = useState(createTabTarget);
  const targetTab = useCallback(
    () => tabTarget.target(() => shownTab.current),
    [tabTarget],
  );

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
      run(async (client) =>
        client.browser.navigate.mutate({ url, tab: await targetTab() }),
      );
    },
    [run, targetTab],
  );

  const newTab = () => {
    setError(null);
    tabTarget.open(
      agentTrpc(agentId)
        .browser.newTab.mutate()
        .then(
          ({ tab }) => tab,
          (e: unknown) => {
            setError(messageOf(e));
            return null;
          },
        ),
    );
  };

  const showReported = (e: unknown): never => {
    const last = reported.current;
    if (last) setSnapshot(last);
    throw e;
  };

  const onShownTab = (
    call: (client: Client, input: { tab: string } | undefined) => unknown,
  ) => {
    run(async (client) => {
      const tab = await targetTab();
      return call(client, tab ? { tab } : undefined);
    });
  };

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
          reported.current = parsed.data;
          tabTarget.reported(parsed.data.activeTab);
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
  }, [agentId, watchKey, run, tabTarget]);

  return {
    connection,
    connects,
    browser: { state: snapshot.state, message: snapshot.message },
    testingMode: snapshot.testingMode,
    page: snapshot.page ?? NO_PAGE,
    tabs: snapshot.tabs,
    activeTab: snapshot.activeTab ?? null,
    error,
    navigate,
    reload: () => onShownTab((client, i) => client.browser.reload.mutate(i)),
    stop: () => onShownTab((client, i) => client.browser.stop.mutate(i)),
    back: () => onShownTab((client, i) => client.browser.back.mutate(i)),
    forward: () => onShownTab((client, i) => client.browser.forward.mutate(i)),
    selectTab: (tab: string) => {
      tabTarget.clear();
      setSnapshot((s) => selectTabLocally(s, tab));
      run((client) =>
        client.browser.selectTab.mutate({ tab }).catch(showReported),
      );
    },
    closeTab: (tab: string) => {
      tabTarget.clear();
      setSnapshot((s) => closeTabLocally(s, tab));
      run((client) =>
        client.browser.closeTab.mutate({ tab }).catch(showReported),
      );
    },
    newTab,
    clearData: () => run((client) => client.browser.clearData.mutate()),
    restartBrowser: () => run((client) => client.browser.restart.mutate()),
    setTestingMode: (on: boolean) =>
      run((client) => client.browser.setTestingMode.mutate({ on })),
    reconnect: () => setWatchKey((k) => k + 1),
  };
}
