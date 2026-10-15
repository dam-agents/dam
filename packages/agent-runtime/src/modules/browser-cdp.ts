import { WebSocket } from "ws";

const CALL_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
const VISIBILITY_POLL_MS = 1_000;
const VISIBILITY_TIMEOUT_MS = 2_000;
export const NEW_TAB_URL = "about:blank";

export interface PageState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface TabState {
  id: string;
  url: string;
  title: string;
  loading: boolean;
}

export interface BrowserView {
  page: PageState | null;
  tabs: TabState[];
  activeTab: string | null;
}

export class TabGoneError extends Error {
  constructor(readonly tab: string) {
    super(`tab ${tab} is closed`);
  }
}

export interface PageWatch {
  state(): BrowserView;
  navigate(url: string, tab?: string): Promise<void>;
  reload(tab?: string): Promise<void>;
  stop(tab?: string): Promise<void>;
  back(tab?: string): Promise<void>;
  forward(tab?: string): Promise<void>;
  select(tab: string): Promise<void>;
  open(): Promise<string>;
  closeTab(tab: string): Promise<string | null>;
  ping(timeoutMs: number): Promise<void>;
  close(): void;
}

export type WatchPages = (opts: {
  url: string;
  onState: (state: BrowserView) => void;
  onClose: () => void;
  log: (msg: string) => void;
  visibilityPollMs?: number;
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
 * It attaches to every page target — the browser's tabs, each known by its
 * target id — and reports each one's address, title and loading the moment
 * Chromium does. It follows the one on screen: the tab whose document is
 * visible, as the kiosk window shows only the active one. Chromium reports no
 * event when another tab comes to the front, so it asks every tab on a short
 * interval, and a tab that has just turned visible wins; a tab the panel
 * selects is on screen at once, and answers already on their way do not take
 * it back. It runs the toolbar's navigation and the tab bar's select, open and
 * close directly, so none waits behind the agent's commands in agent-browser's
 * queue. Each acts on the tab it names, and a tab that is gone — also one that
 * closed between the panel's list and Chromium's answer — fails as gone rather
 * than acting on another one. Closing the tab on screen brings the tab after it
 * in the list to the front, else the one before; closing the last tab opens a
 * blank one first, as the browser would otherwise close its window and exit.
 */
export const watchPages: WatchPages = ({
  url,
  onState,
  onClose,
  log,
  visibilityPollMs = VISIBILITY_POLL_MS,
}) =>
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
    let wasVisible = new Set<string>();
    let selections = 0;
    let last = "";
    let closed = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

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

    const tabOf = (tab?: string): [string, Page] => {
      const id = tab ?? active;
      const page = id === null ? undefined : pages.get(id);
      if (id !== null && page) return [id, page];
      if (tab !== undefined) throw new TabGoneError(tab);
      throw new Error("no page open");
    };

    async function stillOpen(tab: string): Promise<boolean> {
      const r = await call("Target.getTargets").catch(() => null);
      if (!r) return true;
      const infos = (r.targetInfos ?? []) as Record<string, unknown>[];
      return infos.some((info) => info.targetId === tab);
    }

    async function failsAsGone<T>(tab: string, step: () => Promise<T>) {
      try {
        return await step();
      } catch (err) {
        if (pages.has(tab) && (await stillOpen(tab))) throw err;
        forget(tab);
        emit();
        throw new TabGoneError(tab);
      }
    }

    function view(): BrowserView {
      const page = current();
      return {
        page: page && {
          url: page.url,
          title: page.title,
          loading: page.loading,
          canGoBack: page.canGoBack,
          canGoForward: page.canGoForward,
        },
        tabs: [...pages].map(([id, p]) => ({
          id,
          url: p.url,
          title: p.title,
          loading: p.loading,
        })),
        activeTab: page ? active : null,
      };
    }

    function emit() {
      const state = view();
      if (!state.page) return;
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
      emit();
    }

    function setActive(next: string | null) {
      if (next === active) return;
      active = next;
      last = "";
    }

    let picking: Promise<void> | null = null;
    let repick = false;
    function pickActive(): Promise<void> {
      if (picking) {
        repick = true;
        return picking;
      }
      picking = (async () => {
        do {
          repick = false;
          await pickOnce();
        } while (repick && !closed);
      })().finally(() => {
        picking = null;
      });
      return picking;
    }

    async function pickOnce() {
      const selectionsBefore = selections;
      const visible: string[] = [];
      await Promise.all(
        [...pages].map(async ([targetId, page]) => {
          const r = await call(
            "Runtime.evaluate",
            { expression: "document.visibilityState", returnByValue: true },
            page.sessionId,
            VISIBILITY_TIMEOUT_MS,
          ).catch(() => null);
          const value = (r?.result as { value?: unknown } | undefined)?.value;
          if (value === "visible") visible.push(targetId);
        }),
      );
      if (selectionsBefore !== selections) return;
      const order = [...pages.keys()];
      visible.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const fresh = visible.filter((id) => !wasVisible.has(id));
      wasVisible = new Set(visible);
      setActive(
        fresh.at(-1) ??
          (active && visible.includes(active) ? active : visible[0]) ??
          (active && pages.has(active) ? active : order[0]) ??
          null,
      );
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
      emit();
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
        forget(String(p.targetId));
        void settle(pickActive());
        return;
      }
      if (msg.method === "Target.targetInfoChanged") {
        const info = p.targetInfo as Record<string, unknown>;
        const page = pages.get(String(info?.targetId));
        if (!page) return;
        page.url = String(info.url ?? page.url);
        page.title = String(info.title ?? page.title);
        emit();
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
        emit();
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

    function forget(targetId: string) {
      pages.delete(targetId);
      attaching.delete(targetId);
      wasVisible.delete(targetId);
      if (targetId === active) setActive(null);
    }

    ws.on("error", (err) => log(`cdp: ${err.message}`));
    ws.on("close", () => {
      clearTimeout(connectTimer);
      if (pollTimer) clearInterval(pollTimer);
      for (const waiter of pending.values())
        waiter.reject(new Error("CDP connection closed"));
      pending.clear();
      if (closed) return;
      closed = true;
      report(onClose);
    });

    const onTab = async (
      tab: string | undefined,
      method: string,
      params: Record<string, unknown> = {},
    ) => {
      const [id, page] = tabOf(tab);
      await failsAsGone(id, () => call(method, params, page.sessionId));
    };

    const historyStep = async (step: number, tab?: string) => {
      const [id, page] = tabOf(tab);
      await failsAsGone(id, async () => {
        const h = await call("Page.getNavigationHistory", {}, page.sessionId);
        const entries = (h.entries ?? []) as { id: number }[];
        const entry = entries[Number(h.currentIndex) + step];
        if (entry)
          await call(
            "Page.navigateToHistoryEntry",
            { entryId: entry.id },
            page.sessionId,
          );
      });
    };

    async function select(tab: string) {
      tabOf(tab);
      await failsAsGone(tab, () =>
        call("Target.activateTarget", { targetId: tab }),
      );
      selections++;
      wasVisible.add(tab);
      setActive(tab);
      emit();
    }

    async function open(): Promise<string> {
      const r = await call("Target.createTarget", { url: NEW_TAB_URL });
      const targetId = String(r.targetId);
      await attach(targetId, { url: NEW_TAB_URL, title: "" });
      if (pages.has(targetId)) await select(targetId);
      return targetId;
    }

    async function closeTab(tab: string): Promise<string | null> {
      tabOf(tab);
      const order = [...pages.keys()];
      let next: string | null = null;
      if (order.length === 1) next = await open();
      else if (tab === active) {
        const at = order.indexOf(tab);
        next = order[at + 1] ?? order[at - 1] ?? null;
        if (next) await select(next);
      }
      await failsAsGone(tab, () =>
        call("Target.closeTarget", { targetId: tab }),
      );
      forget(tab);
      emit();
      return next;
    }

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
        pollTimer = setInterval(() => {
          if (!picking) void settle(pickActive());
        }, visibilityPollMs);
        pollTimer.unref?.();
        resolve({
          state: view,
          navigate: (to, tab) => onTab(tab, "Page.navigate", { url: to }),
          reload: (tab) => onTab(tab, "Page.reload"),
          stop: (tab) => onTab(tab, "Page.stopLoading"),
          back: (tab) => historyStep(-1, tab),
          forward: (tab) => historyStep(1, tab),
          select,
          open,
          closeTab,
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
            if (pollTimer) clearInterval(pollTimer);
            ws.terminate();
          },
        });
      })();
    });
  });
