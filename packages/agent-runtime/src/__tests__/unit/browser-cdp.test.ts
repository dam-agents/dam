import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import {
  TabGoneError,
  watchPages,
  type BrowserView,
  type PageState,
  type PageWatch,
} from "../../modules/browser-cdp.js";

// TEST_OVERVIEW: the browser panel follows the agent's browser over the Chrome DevTools Protocol: every tab, by its target id, with its address, title and loading, and the address, title, loading and history of the tab on screen reach the panel as Chromium reports them; the toolbar's navigation and the tab bar run on the tab they name directly, and a tab that is gone fails rather than acting on another one.

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
  let opened = 0;
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
      const target = tabs.find((t) => t.id === params?.targetId);
      let result: object = {};
      let error: string | null = null;
      if (method === "Target.activateTarget") {
        if (target) for (const t of tabs) t.visible = t === target;
        else error = "No target with given id found";
      } else if (method === "Target.createTarget") {
        const created = {
          id: `N${++opened}`,
          url: params.url,
          title: "",
          visible: true,
          history: [{ id: 1, url: params.url }],
          index: 0,
        };
        for (const t of tabs) t.visible = false;
        tabs.push(created);
        result = { targetId: created.id };
        setTimeout(() =>
          send({
            method: "Target.targetCreated",
            params: {
              targetInfo: {
                targetId: created.id,
                type: "page",
                url: created.url,
                title: "",
              },
            },
          }),
        );
      } else if (method === "Target.closeTarget") {
        if (target) {
          tabs.splice(tabs.indexOf(target), 1);
          result = { success: true };
          setTimeout(() =>
            send({
              method: "Target.targetDestroyed",
              params: { targetId: target.id },
            }),
          );
        } else error = "No target with given id found";
      } else if (method === "Target.getTargets")
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
              params.expression === "[document.visibilityState, document.title]"
                ? [tab?.visible ? "visible" : "hidden", tab?.title ?? ""]
                : 1,
          },
        };
      else if (sessionId && !tab) error = "Session with given id not found";
      else if (method === "Page.getNavigationHistory" && tab)
        result = { currentIndex: tab.index, entries: tab.history };
      send(error ? { id, error: { message: error } } : { id, result });
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
    vanish: (t: FakeTab) => tabs.splice(tabs.indexOf(t), 1),
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
  const views: BrowserView[] = [];
  let closed = false;
  const page: PageWatch = await watchPages({
    url,
    onState: (s) => {
      views.push(s);
      if (s.page) states.push(s.page);
    },
    onClose: () => {
      closed = true;
    },
    log: () => {},
    visibilityPollMs: 20,
  });
  cleanups.push(() => page.close());
  return { page, states, views, closed: () => closed };
}

describe("watchPages", () => {
  // TEST_SCENARIO: the agent may have several tabs open; the kiosk window shows only the active one, so the panel follows the tab whose document is visible, not the first one Chromium lists.
  it("follows the tab on screen", async () => {
    const hidden = tab("A", "http://hidden/", false);
    const shown = tab("B", "http://shown/", true);
    const chrome = await fakeChrome([hidden, shown]);
    const { page } = await watching(chrome.url);
    expect(page.state().page?.url).toBe("http://shown/");
    expect(page.state().activeTab).toBe("B");
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
    chrome.event("Target.targetInfoChanged", {
      targetInfo: { targetId: "A", type: "page", title: "settled" },
    });
    await until(() => states.at(-1)?.title === "settled");
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
      visibilityPollMs: 20,
      onClose: () => {},
      log: (m) => logged.push(m),
    });
    cleanups.push(() => page.close());
    chrome.event("Page.frameStartedLoading", { frameId: "A" }, t);
    await until(() => page.state().page?.loading === true);
    expect(logged.some((m) => m.includes("listener broke"))).toBe(true);
  });

  // TEST_SCENARIO: the panel lists every tab by its target id, with the title and loading of each — not only the one on screen — and a tab opened behind its back, by the agent or a page's link, appears and one closed disappears, with no reload.
  it("lists every tab and follows tabs opening and closing", async () => {
    const a = tab("A", "http://a/", true);
    const b = tab("B", "http://b/", false);
    const chrome = await fakeChrome([a, b]);
    const { page } = await watching(chrome.url);
    expect(page.state().tabs.map((t) => t.id)).toEqual(["A", "B"]);

    chrome.event("Page.frameStartedLoading", { frameId: "B" }, b);
    chrome.event("Target.targetInfoChanged", {
      targetInfo: {
        targetId: "B",
        type: "page",
        url: "http://b/",
        title: "Bee",
      },
    });
    await until(() => page.state().tabs[1]?.loading === true);
    expect(page.state().tabs[1]).toEqual({
      id: "B",
      url: "http://b/",
      title: "Bee",
      loading: true,
    });
    expect(page.state().activeTab).toBe("A");

    chrome.event("Target.targetCreated", {
      targetInfo: { targetId: "C", type: "page", url: "http://c/", title: "" },
    });
    await until(() => page.state().tabs.some((t) => t.id === "C"));
    chrome.event("Target.targetDestroyed", { targetId: "B" });
    await until(() => !page.state().tabs.some((t) => t.id === "B"));
    expect(page.state().tabs.map((t) => t.id)).toEqual(["A", "C"]);
  });

  // TEST_SCENARIO: the agent brings another tab to the front — `agent-browser tab`, or a page's popup — and Chromium sends no event for it; the panel still follows the tab on screen within its short interval, and the toolbar's state is that tab's.
  it("follows a tab brought to the front without an event", async () => {
    const a = tab("A", "http://a/", true);
    const b = tab("B", "http://b/", false);
    const chrome = await fakeChrome([a, b]);
    const { page } = await watching(chrome.url);
    expect(page.state().activeTab).toBe("A");
    a.visible = false;
    b.visible = true;
    await until(() => page.state().activeTab === "B");
    expect(page.state().page?.url).toBe("http://b/");
  });

  // TEST_SCENARIO: a script renames a page — an app showing its unread count, the agent setting document.title — and Chromium reports no target change for it; the tab bar still shows the new title within the short interval, for a tab not on screen too.
  it("follows a page renamed by a script", async () => {
    const a = tab("A", "http://a/", true);
    const b = tab("B", "http://b/", false);
    const chrome = await fakeChrome([a, b]);
    const { page } = await watching(chrome.url);
    b.title = "Renamed";
    await until(() => page.state().tabs[1]?.title === "Renamed");
    a.title = "Inbox (3)";
    await until(() => page.state().page?.title === "Inbox (3)");
  });

  // TEST_SCENARIO: the panel selects a tab: it comes to the front by its target id and is the active tab at once, before any visibility answer; an answer that was already on its way, saying the old tab is on screen, does not take it back.
  it("selects a tab by its target id", async () => {
    const a = tab("A", "http://a/", true);
    const b = tab("B", "http://b/", false);
    const chrome = await fakeChrome([a, b]);
    const { page, views } = await watching(chrome.url);
    await page.select("B");
    expect(page.state().activeTab).toBe("B");
    expect(chrome.calls).toContainEqual({
      method: "Target.activateTarget",
      sessionId: undefined,
      params: { targetId: "B" },
    });
    const seen = views.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(views.slice(seen).every((v) => v.activeTab === "B")).toBe(true);
  });

  // TEST_SCENARIO: the toolbar names the tab the user sees; when the agent has meanwhile brought another tab to the front, the action still lands on the named tab, and a named tab that has closed fails as gone, sending nothing to any page, rather than acting on the tab now on screen.
  it("acts on the named tab and refuses a closed one", async () => {
    const a = tab("A", "http://a/", false);
    const b = tab("B", "http://b/", true);
    const chrome = await fakeChrome([a, b]);
    const { page } = await watching(chrome.url);
    await page.reload("A");
    expect(chrome.calls.filter((c) => c.method === "Page.reload")).toEqual([
      { method: "Page.reload", sessionId: "s-A", params: {} },
    ]);

    const before = chrome.calls.length;
    for (const step of [
      () => page.navigate("http://x/", "gone"),
      () => page.reload("gone"),
      () => page.back("gone"),
      () => page.select("gone"),
      () => page.closeTab("gone"),
    ])
      await expect(step()).rejects.toBeInstanceOf(TabGoneError);
    expect(chrome.calls.slice(before)).toEqual([]);
  });

  // TEST_SCENARIO: a tab that closes between the panel's list and Chromium's answer — the command reaches a target already destroyed, before its destroyed event — fails as gone, not as a browser error, and leaves the panel's list.
  it("reports a tab closed during an action as gone", async () => {
    const a = tab("A", "http://a/", true);
    const b = tab("B", "http://b/", false);
    const c = tab("C", "http://c/", false);
    const chrome = await fakeChrome([a, b, c]);
    const { page } = await watching(chrome.url);
    chrome.vanish(b);
    await expect(page.reload("B")).rejects.toBeInstanceOf(TabGoneError);
    chrome.vanish(c);
    await expect(page.select("C")).rejects.toBeInstanceOf(TabGoneError);
    expect(page.state().tabs.map((t) => t.id)).toEqual(["A"]);
    expect(page.state().activeTab).toBe("A");
  });

  // TEST_SCENARIO: a new tab from the panel is a blank page, opened over CDP and the active tab at once; closing the active tab selects the tab after it, else the one before; closing the last tab opens a blank one first, so the browser keeps a window and the panel a page.
  it("opens and closes tabs predictably", async () => {
    const a = tab("A", "http://a/", true);
    const b = tab("B", "http://b/", false);
    const c = tab("C", "http://c/", false);
    const chrome = await fakeChrome([a, b, c]);
    const { page } = await watching(chrome.url);

    await page.select("B");
    expect(await page.closeTab("B")).toBe("C");
    expect(page.state().activeTab).toBe("C");
    expect(page.state().tabs.map((t) => t.id)).toEqual(["A", "C"]);

    expect(await page.closeTab("C")).toBe("A");
    expect(page.state().activeTab).toBe("A");

    expect(await page.closeTab("A")).toMatch(/^N/);
    const blank = page.state();
    expect(blank.tabs).toHaveLength(1);
    expect(blank.tabs[0]?.url).toBe("about:blank");
    expect(blank.activeTab).toBe(blank.tabs[0]?.id);

    const opened = await page.open();
    expect(page.state().activeTab).toBe(opened);
    expect(page.state().tabs).toHaveLength(2);
  });

  // TEST_SCENARIO: closing a tab that is not on screen leaves the active tab as it is.
  it("keeps the active tab when another closes", async () => {
    const a = tab("A", "http://a/", true);
    const b = tab("B", "http://b/", false);
    const chrome = await fakeChrome([a, b]);
    const { page } = await watching(chrome.url);
    expect(await page.closeTab("B")).toBeNull();
    expect(page.state().activeTab).toBe("A");
    expect(page.state().tabs.map((t) => t.id)).toEqual(["A"]);
  });

  // TEST_SCENARIO: the browser went away — crashed, closed by the agent — and its CDP connection dropped; the supervisor is told at once, which is how it relaunches a dead browser without waiting on health checks.
  it("reports a dropped connection", async () => {
    const chrome = await fakeChrome([tab("A", "http://a/", true)]);
    const { closed } = await watching(chrome.url);
    chrome.drop();
    await until(closed);
  });
});
