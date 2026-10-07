import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import {
  watchPages,
  type PageState,
  type PageWatch,
} from "../../modules/browser-cdp.js";

// TEST_OVERVIEW: the browser panel follows the agent's browser over the Chrome DevTools Protocol: the address, title, loading and history of the tab on screen reach the panel as Chromium reports them, and the toolbar's navigation runs on that tab directly.

interface FakeTab {
  id: string;
  url: string;
  title: string;
  visible: boolean;
  history: { id: number; url: string }[];
  index: number;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function until(check: () => boolean, ms = 3_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function fakeChrome(tabs: FakeTab[]) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const calls: { method: string; sessionId?: string; params: unknown }[] = [];
  let client: WebSocket | null = null;
  const sessionOf = (t: FakeTab) => `s-${t.id}`;
  const tabOf = (sessionId?: string) =>
    tabs.find((t) => sessionOf(t) === sessionId);
  const send = (msg: object) => client?.send(JSON.stringify(msg));
  wss.on("connection", (ws) => {
    client = ws;
    ws.on("message", (data: Buffer) => {
      const { id, method, params, sessionId } = JSON.parse(data.toString());
      calls.push({ method, sessionId, params });
      const tab = tabOf(sessionId);
      let result: object = {};
      if (method === "Target.getTargets")
        result = {
          targetInfos: tabs.map((t) => ({
            targetId: t.id,
            type: "page",
            url: t.url,
            title: t.title,
          })),
        };
      else if (method === "Target.setDiscoverTargets")
        for (const t of tabs)
          send({
            method: "Target.targetCreated",
            params: {
              targetInfo: {
                targetId: t.id,
                type: "page",
                url: t.url,
                title: t.title,
              },
            },
          });
      else if (method === "Target.attachToTarget")
        result = { sessionId: `s-${params.targetId}` };
      else if (method === "Runtime.evaluate")
        result = {
          result: {
            value:
              params.expression === "document.visibilityState"
                ? tab?.visible
                  ? "visible"
                  : "hidden"
                : 1,
          },
        };
      else if (method === "Page.getNavigationHistory" && tab)
        result = { currentIndex: tab.index, entries: tab.history };
      send({ id, result });
    });
  });
  cleanups.push(() => {
    client?.terminate();
    wss.close();
  });
  const port = (wss.address() as { port: number }).port;
  return {
    url: `ws://127.0.0.1:${port}/devtools/browser/x`,
    calls,
    event: (method: string, params: object, tab?: FakeTab) =>
      send({ method, params, sessionId: tab ? sessionOf(tab) : undefined }),
    drop: () => client?.terminate(),
  };
}

function tab(id: string, url: string, visible: boolean): FakeTab {
  return {
    id,
    url,
    title: "",
    visible,
    history: [{ id: 1, url }],
    index: 0,
  };
}

async function watching(url: string) {
  const states: PageState[] = [];
  let closed = false;
  const page: PageWatch = await watchPages({
    url,
    onState: (s) => states.push(s),
    onClose: () => {
      closed = true;
    },
    log: () => {},
  });
  cleanups.push(() => page.close());
  return { page, states, closed: () => closed };
}

describe("watchPages", () => {
  // TEST_SCENARIO: the agent may have several tabs open; the kiosk window shows only the active one, so the panel follows the tab whose document is visible, not the first one Chromium lists.
  it("follows the tab on screen", async () => {
    const hidden = tab("A", "http://hidden/", false);
    const shown = tab("B", "http://shown/", true);
    const chrome = await fakeChrome([hidden, shown]);
    const { page } = await watching(chrome.url);
    expect(page.state()?.url).toBe("http://shown/");
  });

  // TEST_SCENARIO: a page loads: the panel sees it start loading, its new address and title, and the end of the load with the history it left — Back now possible — as Chromium reports each, with no polling.
  it("reports loading, address, title and history as they change", async () => {
    const t = tab("A", "http://a/", true);
    const chrome = await fakeChrome([t]);
    const { states } = await watching(chrome.url);

    chrome.event("Page.frameStartedLoading", { frameId: "A" }, t);
    await until(() => states.at(-1)?.loading === true);

    t.history.push({ id: 2, url: "http://b/" });
    t.index = 1;
    chrome.event(
      "Page.frameNavigated",
      { frame: { id: "A", url: "http://b/" } },
      t,
    );
    chrome.event("Target.targetInfoChanged", {
      targetInfo: { targetId: "A", type: "page", url: "http://b/", title: "B" },
    });
    chrome.event("Page.frameStoppedLoading", { frameId: "A" }, t);
    await until(() => states.at(-1)?.loading === false);
    await until(() => states.at(-1)?.canGoBack === true);
    expect(states.at(-1)).toMatchObject({
      url: "http://b/",
      title: "B",
      canGoForward: false,
    });
  });

  // TEST_SCENARIO: a frame inside the page loading or navigating is not the page's own load; it changes nothing the toolbar shows.
  it("ignores a subframe's loads", async () => {
    const t = tab("A", "http://a/", true);
    const chrome = await fakeChrome([t]);
    const { states } = await watching(chrome.url);
    const seen = states.length;
    chrome.event("Page.frameStartedLoading", { frameId: "ad-frame" }, t);
    chrome.event(
      "Page.frameNavigated",
      { frame: { id: "ad-frame", parentId: "A", url: "http://ads/" } },
      t,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(states.slice(seen).every((s) => !s.loading)).toBe(true);
    expect(states.at(-1)?.url).toBe("http://a/");
  });

  // TEST_SCENARIO: the toolbar acts on the tab on screen directly: navigate, reload and stop are page commands, and back steps to the previous history entry.
  it("runs the toolbar on the tab on screen", async () => {
    const t = tab("A", "http://a/", true);
    t.history.push({ id: 7, url: "http://b/" });
    t.index = 1;
    const chrome = await fakeChrome([t]);
    const { page } = await watching(chrome.url);
    await page.navigate("http://c/");
    await page.reload();
    await page.stop();
    await page.back();
    const on = (m: string) =>
      chrome.calls.filter((c) => c.method === m && c.sessionId === "s-A");
    expect(on("Page.navigate")[0]?.params).toEqual({ url: "http://c/" });
    expect(on("Page.reload")).toHaveLength(1);
    expect(on("Page.stopLoading")).toHaveLength(1);
    expect(on("Page.navigateToHistoryEntry")[0]?.params).toEqual({
      entryId: 1,
    });
  });

  // TEST_SCENARIO: a listener that throws must not escape the watcher: its events arrive on a socket handler, where a throw or a rejected promise takes the whole runtime down.
  it("keeps a throwing listener inside the watcher", async () => {
    const t = tab("A", "http://a/", true);
    const chrome = await fakeChrome([t]);
    const logged: string[] = [];
    const page = await watchPages({
      url: chrome.url,
      onState: () => {
        throw new Error("listener broke");
      },
      onClose: () => {},
      log: (m) => logged.push(m),
    });
    cleanups.push(() => page.close());
    chrome.event("Page.frameStartedLoading", { frameId: "A" }, t);
    await until(() => page.state()?.loading === true);
    expect(logged.some((m) => m.includes("listener broke"))).toBe(true);
  });

  // TEST_SCENARIO: the browser went away — crashed, closed by the agent — and its CDP connection dropped; the supervisor is told at once, which is how it relaunches a dead browser without waiting on health checks.
  it("reports a dropped connection", async () => {
    const chrome = await fakeChrome([tab("A", "http://a/", true)]);
    const { closed } = await watching(chrome.url);
    chrome.drop();
    await until(closed);
  });
});
