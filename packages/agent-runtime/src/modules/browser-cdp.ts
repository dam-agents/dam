import { WebSocket } from "ws";

const CALL_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;

export interface PageState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PageWatch {
  state(): PageState | null;
  navigate(url: string): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  ping(timeoutMs: number): Promise<void>;
  close(): void;
}

export type WatchPages = (opts: {
  url: string;
  onState: (state: PageState) => void;
  onClose: () => void;
  log: (msg: string) => void;
}) => Promise<PageWatch>;

interface Page {
  sessionId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the panel's view of the agent's browser over the
 * Chrome DevTools Protocol, on a connection of its own beside agent-browser's.
 * It attaches to every page target and follows the one on screen — the tab
 * whose document is visible, as the kiosk window shows only the active one —
 * reporting its address, title, loading and history the moment Chromium
 * does, and runs the toolbar's navigation on it directly, so neither waits
 * behind the agent's commands in agent-browser's queue.
 */
export const watchPages: WatchPages = ({ url, onState, onClose, log }) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    let nextId = 1;
    const pending = new Map<
      number,
      {
        resolve: (r: Record<string, unknown>) => void;
        reject: (e: Error) => void;
      }
    >();
    const pages = new Map<string, Page>();
    let active: string | null = null;
    let last = "";
    let closed = false;

    const connectTimer = setTimeout(() => {
      ws.terminate();
      reject(new Error("CDP connect timed out"));
    }, CONNECT_TIMEOUT_MS);

    function call(
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
      timeoutMs = CALL_TIMEOUT_MS,
    ): Promise<Record<string, unknown>> {
      if (ws.readyState !== WebSocket.OPEN)
        return Promise.reject(new Error("CDP connection closed"));
      const id = nextId++;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`${method} timed out`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (r) => {
            clearTimeout(timer);
            res(r);
          },
          reject: (e) => {
            clearTimeout(timer);
            rej(e);
          },
        });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    }

    const settle = (step: Promise<unknown>) =>
      step.catch((err: Error) => log(`cdp: ${err.message}`));
    const report = (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        log(`cdp: ${(err as Error).message}`);
      }
    };

    const current = (): Page | null => (active && pages.get(active)) || null;

    function emit() {
      const page = current();
      if (!page) return;
      const state: PageState = {
        url: page.url,
        title: page.title,
        loading: page.loading,
        canGoBack: page.canGoBack,
        canGoForward: page.canGoForward,
      };
      const key = JSON.stringify(state);
      if (key === last) return;
      last = key;
      report(() => onState(state));
    }

    async function refreshHistory(targetId: string, withTitle = false) {
      const page = pages.get(targetId);
      if (!page) return;
      const [h, title] = await Promise.all([
        call("Page.getNavigationHistory", {}, page.sessionId).catch(() => null),
        withTitle
          ? call(
              "Runtime.evaluate",
              { expression: "document.title", returnByValue: true },
              page.sessionId,
            ).catch(() => null)
          : null,
      ]);
      const value = (title?.result as { value?: unknown } | undefined)?.value;
      if (typeof value === "string" && value) page.title = value;
      if (!h) return;
      const index = Number(h.currentIndex);
      const entries = Array.isArray(h.entries) ? h.entries.length : 0;
      page.canGoBack = index > 0;
      page.canGoForward = index < entries - 1;
      if (targetId === active) emit();
    }

    async function pickActive() {
      const visible: string[] = [];
      await Promise.all(
        [...pages].map(async ([targetId, page]) => {
          const r = await call(
            "Runtime.evaluate",
            { expression: "document.visibilityState", returnByValue: true },
            page.sessionId,
          ).catch(() => null);
          const value = (r?.result as { value?: unknown } | undefined)?.value;
          if (value === "visible") visible.push(targetId);
        }),
      );
      const next =
        (active && visible.includes(active) ? active : visible[0]) ??
        (active && pages.has(active) ? active : [...pages.keys()][0]) ??
        null;
      if (next !== active) {
        active = next;
        last = "";
      }
      emit();
    }

    const attaching = new Map<string, Promise<void>>();
    function attach(targetId: string, info: Record<string, unknown>) {
      let started = attaching.get(targetId);
      if (!started) {
        started = attachOnce(targetId, info);
        attaching.set(targetId, started);
      }
      return started;
    }

    async function attachOnce(targetId: string, info: Record<string, unknown>) {
      const r = await call("Target.attachToTarget", {
        targetId,
        flatten: true,
      }).catch((err: Error) => {
        log(`cdp: attach: ${err.message}`);
        return null;
      });
      const sessionId = r?.sessionId;
      if (typeof sessionId !== "string") return;
      pages.set(targetId, {
        sessionId,
        url: String(info.url ?? ""),
        title: String(info.title ?? ""),
        loading: false,
        canGoBack: false,
        canGoForward: false,
      });
      await call("Page.enable", {}, sessionId).catch(() => null);
      await refreshHistory(targetId);
      await pickActive();
    }

    const pageOf = (sessionId: string | undefined): [string, Page] | null => {
      for (const entry of pages)
        if (entry[1].sessionId === sessionId) return entry;
      return null;
    };

    function onEvent(msg: CdpMessage) {
      const p = msg.params ?? {};
      if (msg.method === "Target.targetCreated") {
        const info = p.targetInfo as Record<string, unknown>;
        if (info?.type === "page")
          void settle(attach(String(info.targetId), info));
        return;
      }
      if (msg.method === "Target.targetDestroyed") {
        pages.delete(String(p.targetId));
        attaching.delete(String(p.targetId));
        void settle(pickActive());
        return;
      }
      if (msg.method === "Target.targetInfoChanged") {
        const info = p.targetInfo as Record<string, unknown>;
        const page = pages.get(String(info?.targetId));
        if (!page) return;
        page.url = String(info.url ?? page.url);
        page.title = String(info.title ?? page.title);
        if (String(info.targetId) === active) emit();
        return;
      }
      const found = pageOf(msg.sessionId);
      if (!found) return;
      const [targetId, page] = found;
      if (p.frameId !== undefined && p.frameId !== targetId) {
        const frame = p.frame as { id?: string; parentId?: string } | undefined;
        if (!(frame && !frame.parentId)) return;
      }
      if (msg.method === "Page.frameStartedLoading") {
        page.loading = true;
        if (targetId === active) emit();
      } else if (msg.method === "Page.frameStoppedLoading") {
        page.loading = false;
        void settle(refreshHistory(targetId, true));
        void settle(pickActive());
      } else if (msg.method === "Page.frameNavigated") {
        const frame = p.frame as { url?: string; parentId?: string };
        if (frame.parentId) return;
        page.url = String(frame.url ?? page.url);
        void settle(refreshHistory(targetId));
      } else if (msg.method === "Page.navigatedWithinDocument") {
        page.url = String(p.url ?? page.url);
        void settle(refreshHistory(targetId));
      }
    }

    ws.on("message", (data: Buffer) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(data.toString()) as CdpMessage;
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const waiter = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) waiter?.reject(new Error(msg.error.message));
        else waiter?.resolve(msg.result ?? {});
        return;
      }
      report(() => onEvent(msg));
    });

    ws.on("error", (err) => log(`cdp: ${err.message}`));
    ws.on("close", () => {
      clearTimeout(connectTimer);
      for (const waiter of pending.values())
        waiter.reject(new Error("CDP connection closed"));
      pending.clear();
      if (closed) return;
      closed = true;
      report(onClose);
    });

    const onActive = async (
      method: string,
      params: Record<string, unknown> = {},
    ) => {
      const page = current();
      if (!page) throw new Error("no page open");
      await call(method, params, page.sessionId);
    };

    const historyStep = async (step: number) => {
      const page = current();
      if (!page) throw new Error("no page open");
      const h = await call("Page.getNavigationHistory", {}, page.sessionId);
      const entries = (h.entries ?? []) as { id: number }[];
      const entry = entries[Number(h.currentIndex) + step];
      if (entry)
        await call(
          "Page.navigateToHistoryEntry",
          { entryId: entry.id },
          page.sessionId,
        );
    };

    ws.on("open", () => {
      clearTimeout(connectTimer);
      void (async () => {
        try {
          await call("Target.setDiscoverTargets", { discover: true });
          const r = await call("Target.getTargets");
          const infos = (r.targetInfos ?? []) as Record<string, unknown>[];
          for (const info of infos)
            if (info.type === "page") await attach(String(info.targetId), info);
          await pickActive();
        } catch (err) {
          ws.terminate();
          reject(err as Error);
          return;
        }
        resolve({
          state: () => {
            const page = current();
            return page
              ? {
                  url: page.url,
                  title: page.title,
                  loading: page.loading,
                  canGoBack: page.canGoBack,
                  canGoForward: page.canGoForward,
                }
              : null;
          },
          navigate: (to) => onActive("Page.navigate", { url: to }),
          reload: () => onActive("Page.reload"),
          stop: () => onActive("Page.stopLoading"),
          back: () => historyStep(-1),
          forward: () => historyStep(1),
          ping: async (timeoutMs) => {
            const page = current();
            await call(
              "Runtime.evaluate",
              { expression: "1", returnByValue: true },
              page?.sessionId,
              timeoutMs,
            );
          },
          close: () => {
            closed = true;
            ws.terminate();
          },
        });
      })();
    });
  });
