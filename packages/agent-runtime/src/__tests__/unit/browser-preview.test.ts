import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { WatchPages } from "../../modules/browser-cdp.js";
import type { BrowserSnapshot } from "agent-runtime-api";
import {
  LAUNCH,
  NEW_TAB_PAGE,
  commandTimeoutMs,
  createCommandQueue,
  displayAvailable,
  isPreviewProcess,
  killablePreviewPids,
  createBrowserPreview,
  previewUrl,
  type BrowserPreview,
} from "../../modules/browser-preview.js";

// TEST_OVERVIEW: The browser panel shows the agent's one browser — the one every plain agent-browser command drives — streamed from its virtual display. A single supervisor keeps that browser up for every panel watching it: it launches it once, runs its own browser commands one at a time, tells the panels the page's address and the browser's state, runs their toolbar, and brings the browser back — without dropping the panels — when it fails to start, dies, or stops answering. It is offered only on an agent that requires named connections. A panel's display socket is relayed to the display's stream server.

const closers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

let lastBrowser: { alive: boolean } | null = null;
const launched = () => lastBrowser?.alive === true;
const isLaunch = (c: string[]) => c[0] === LAUNCH[0] && c[1] === LAUNCH[1];

function fakeBrowser() {
  const calls: string[][] = [];
  const browser = {
    alive: false,
    url: "about:blank",
    launchFailures: 0,
    hangPing: false,
    failPing: false,
    pings: 0,
    die: () => {},
  };
  const run = async (args: string[]) => {
    calls.push(args);
    if (isLaunch(args)) {
      if (!browser.alive && browser.launchFailures > 0) {
        browser.launchFailures--;
        throw new Error("Chrome exited early");
      }
      browser.alive = true;
      return browser.url;
    }
    if (!browser.alive) throw new Error("no browser running");
    if (args[0] === "get" && args[1] === "cdp-url") return "ws://cdp\n";
    return "";
  };
  const watch: WatchPages = async ({ onState, onClose }) => {
    if (!browser.alive) throw new Error("CDP connection closed");
    let open = true;
    const state = () => ({
      url: browser.url,
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    });
    browser.die = () => {
      browser.alive = false;
      if (open) onClose();
    };
    const act = (name: string, arg?: string) => {
      calls.push(["page", name, ...(arg ? [arg] : [])]);
      return Promise.resolve();
    };
    return {
      state,
      navigate: (url) => {
        browser.url = url;
        onState(state());
        return act("navigate", url);
      },
      reload: () => act("reload"),
      stop: () => act("stop"),
      back: () => act("back"),
      forward: () => act("forward"),
      ping: () => {
        browser.pings++;
        if (browser.hangPing) return new Promise<void>(() => {});
        if (browser.failPing)
          return Promise.reject(new Error("Runtime.evaluate timed out"));
        return Promise.resolve();
      },
      close: () => {
        open = false;
      },
    };
  };
  lastBrowser = browser;
  return { calls, run, watch, browser };
}

async function displayHost(preview: BrowserPreview) {
  const wss = new WebSocketServer({ noServer: true });
  const server: Server = createServer();
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => preview.attachDisplay(ws));
  });
  await new Promise<void>((r) => server.listen(0, r));
  closers.push(() => {
    preview.close();
    return new Promise<void>((r) => server.close(() => r()));
  });
  const port = (server.address() as { port: number }).port;
  return async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    closers.push(() => ws.terminate());
    const messages: (string | Buffer)[] = [];
    ws.on("message", (d: Buffer, isBinary) =>
      messages.push(isBinary ? d : d.toString()),
    );
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    return { ws, messages };
  };
}

function watching(preview: BrowserPreview) {
  const abort = new AbortController();
  const snapshots: BrowserSnapshot[] = [];
  const result = preview.watch(abort.signal);
  if (!result.ok) throw new Error(`watch refused: ${result.error.kind}`);
  void (async () => {
    for await (const snapshot of result.value) snapshots.push(snapshot);
  })();
  closers.push(() => abort.abort());
  const states = () =>
    snapshots
      .map((s) => s.state)
      .filter((state, i, all) => i === 0 || all[i - 1] !== state);
  return {
    snapshots,
    states,
    page: () => snapshots.at(-1)?.page ?? null,
    stop: () => abort.abort(),
  };
}

async function until(check: () => boolean, ms = 3_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function preview(
  fake: ReturnType<typeof fakeBrowser>,
  extra: Partial<Parameters<typeof createBrowserPreview>[0]> = {},
) {
  return createBrowserPreview({
    run: fake.run,
    watch: fake.watch,
    profileDir: "/tmp/x",
    socketDir: "/tmp/y",
    available: () => true,
    offered: () => true,
    stopBrowser: async () => {},
    retryDelaysMs: [10],
    log: () => {},
    ...extra,
  });
}

async function freePort(): Promise<number> {
  return new Promise<number>((resolve) => {
    const probe = createTcpServer();
    probe.listen(0, "127.0.0.1", () => {
      const p = (probe.address() as { port: number }).port;
      probe.close(() => resolve(p));
    });
  });
}

describe("previewUrl", () => {
  // TEST_SCENARIO: The panel's address field takes any web address — loopback dev servers and external sign-in pages alike — but nothing that is not http or https, so `file:` or `javascript:` never reach the browser.
  it("accepts http and https only", () => {
    expect(previewUrl("http://127.0.0.1:4444/x")).toBe(
      "http://127.0.0.1:4444/x",
    );
    expect(previewUrl("https://github.com/login")).toBe(
      "https://github.com/login",
    );
    expect(previewUrl("file:///etc/passwd")).toBeNull();
    expect(previewUrl("javascript:alert(1)")).toBeNull();
    expect(previewUrl("not a url")).toBeNull();
  });
});

describe("browser preview", () => {
  // TEST_SCENARIO: A panel starts watching. The browser is launched through agent-browser — the same browser the agent's own commands drive — and the panel is told it is ready and what page it shows. An address from the panel opens over CDP, and the page's state reaches the panel as the browser reports it, with no polling.
  it("launches, navigates and reports the page", async () => {
    const fake = fakeBrowser();
    const browser = preview(fake);
    closers.push(() => browser.close());
    const panel = watching(browser);
    await until(launched);
    expect(isLaunch(fake.calls[0]!)).toBe(true);
    await until(() => panel.states().includes("ready"));
    expect(panel.page()?.url).toBe(NEW_TAB_PAGE);
    expect(await browser.navigate("http://127.0.0.1:5173")).toEqual({
      ok: true,
      value: undefined,
    });
    await until(() => panel.page()?.url === "http://127.0.0.1:5173/");
    expect(fake.calls).toContainEqual([
      "page",
      "navigate",
      "http://127.0.0.1:5173/",
    ]);
  });

  // TEST_SCENARIO: agent-browser launches the browser on a blank page. A fresh panel shows Chromium's new tab page there instead of an empty white one — on the first launch, after Restart browser and after Clear browser data — so the browser looks ready to use.
  it("opens the new tab page on a fresh browser", async () => {
    const fake = fakeBrowser();
    const browser = preview(fake, {
      stopBrowser: async () => {
        fake.browser.alive = false;
        fake.browser.url = "about:blank";
      },
    });
    closers.push(() => browser.close());
    const navigations = () =>
      fake.calls.filter((c) => c[0] === "page" && c[1] === "navigate");
    const panel = watching(browser);
    await until(() => navigations().length === 1);
    for (const action of ["restart", "clearData"] as const) {
      expect((await browser.act(action)).ok).toBe(true);
      await until(
        () => navigations().length === (action === "restart" ? 2 : 3),
      );
    }
    await until(() => panel.states().at(-1) === "ready");
    expect(panel.page()?.url).toBe(NEW_TAB_PAGE);
    expect(fake.calls.filter(isLaunch)).toHaveLength(3);
    expect(navigations()).toEqual(
      Array(3).fill(["page", "navigate", NEW_TAB_PAGE]),
    );
  });

  // TEST_SCENARIO: the new tab page only replaces a blank page. A browser the agent already opened a page in keeps it, and an address the panel asked for before the browser was up opens instead of the new tab page.
  it("keeps a page that is already open or asked for", async () => {
    const shown = fakeBrowser();
    shown.browser.url = "http://127.0.0.1:3000/";
    const first = preview(shown);
    closers.push(() => first.close());
    const panel = watching(first);
    await until(() => panel.states().includes("ready"));
    expect(panel.page()?.url).toBe("http://127.0.0.1:3000/");

    const asked = fakeBrowser();
    const second = preview(asked);
    closers.push(() => second.close());
    expect((await second.navigate("http://127.0.0.1:5173")).ok).toBe(true);
    const other = watching(second);
    await until(() => other.states().includes("ready"));
    expect(other.page()?.url).toBe("http://127.0.0.1:5173/");

    for (const { calls } of [shown, asked])
      expect(calls).not.toContainEqual(["page", "navigate", NEW_TAB_PAGE]);
  });

  // TEST_SCENARIO: the CDP watcher reports the page's state as soon as it attaches, before it has returned to the supervisor. That early report must not break the launch: reading the watcher before it was assigned threw, failed every launch and, from the watcher's event handlers, crashed the runtime.
  it("launches when the watcher reports state before it returns", async () => {
    const fake = fakeBrowser();
    const eager: WatchPages = async (opts) => {
      const watcher = await fake.watch(opts);
      opts.onState(watcher.state()!);
      return watcher;
    };
    const browser = preview(fake, { watch: eager });
    closers.push(() => browser.close());
    const panel = watching(browser);
    await until(() => panel.states().includes("ready"));
    expect(panel.page()).not.toBeNull();
    expect(panel.states()).not.toContain("failed");
  });

  // TEST_SCENARIO: the browser panel is the user browsing from inside the agent's sandbox, through its gateway. On an agent whose gateway injects its credentials into unaddressed requests, that would be browsing as the agent's accounts, so the platform refuses it there — not only hides it: watching, every toolbar action and the display socket are refused before any browser starts. An image without the display stack is refused the same way, with its own reason.
  it("refuses an agent without named connections, or without a display", async () => {
    for (const [extra, kind] of [
      [{ offered: () => false }, "NotOffered"],
      [{ available: () => false }, "NoDisplay"],
    ] as const) {
      const fake = fakeBrowser();
      const browser = preview(fake, extra);
      closers.push(() => browser.close());
      expect(browser.watch()).toEqual({ ok: false, error: { kind } });
      expect(await browser.navigate("http://a/")).toEqual({
        ok: false,
        error: { kind },
      });
      expect(await browser.act("restart")).toEqual({
        ok: false,
        error: { kind },
      });
      const connect = await displayHost(browser);
      const { ws } = await connect();
      const code = await new Promise<number>((r) => ws.once("close", r));
      expect(code).toBe(1011);
      expect(fake.calls).toEqual([]);
    }
  });

  // TEST_SCENARIO: The toolbar's reload, stop, back and forward run on the page over CDP, never through agent-browser, whose one-at-a-time queue may hold the agent's own commands. A non-web address is refused rather than opened.
  it("runs the toolbar on the page and refuses non-web addresses", async () => {
    const fake = fakeBrowser();
    const browser = preview(fake);
    closers.push(() => browser.close());
    const panel = watching(browser);
    await until(() => panel.states().includes("ready"));

    for (const action of ["reload", "stop", "back", "forward"] as const)
      expect((await browser.act(action)).ok).toBe(true);
    expect(await browser.navigate("file:///etc/passwd")).toEqual({
      ok: false,
      error: { kind: "NotWebAddress" },
    });
    for (const action of ["reload", "stop", "back", "forward"])
      expect(fake.calls).toContainEqual(["page", action]);
    expect(fake.calls.flat()).not.toContain("file:///etc/passwd");
    expect(fake.calls.filter((c) => c[0] === "eval")).toEqual([]);
  });

  // TEST_SCENARIO: an address sent before the browser is up — the panel opened on a link — is opened once it is.
  it("opens an address sent while the browser starts", async () => {
    const fake = fakeBrowser();
    fake.browser.launchFailures = 1;
    const browser = preview(fake);
    closers.push(() => browser.close());
    const panel = watching(browser);
    expect((await browser.navigate("http://a/")).ok).toBe(true);
    await until(() => panel.states().at(-1) === "ready");
    await until(() =>
      fake.calls.some((c) => c[0] === "page" && c[2] === "http://a/"),
    );
  });

  // TEST_SCENARIO: the agent may be using the browser while no panel is open, so the last panel leaving leaves it running; the supervisor only stops watching it.
  it("leaves the browser running when the last panel leaves", async () => {
    const fake = fakeBrowser();
    let stops = 0;
    const browser = preview(fake, {
      healthCheckMs: 20,
      stopBrowser: async () => {
        stops++;
      },
    });
    closers.push(() => browser.close());
    const panel = watching(browser);
    await until(launched);
    panel.stop();
    await until(() => browser.viewers() === 0);
    await pause(60);
    const pings = fake.browser.pings;
    await pause(100);
    expect(stops).toBe(0);
    expect(fake.browser.pings).toBe(pings);
  });
});

describe("one browser for every panel", () => {
  // TEST_SCENARIO: two panels — two tabs, or a reconnect racing the old subscription — must not launch the browser twice; they share one launch and both are told it is ready.
  it("shares one launch between panels", async () => {
    const fake = fakeBrowser();
    const browser = preview(fake);
    closers.push(() => browser.close());
    const a = watching(browser);
    const b = watching(browser);
    await until(() => a.states().includes("ready"));
    await until(() => b.states().includes("ready"));
    expect(fake.calls.filter(isLaunch)).toHaveLength(1);
  });
});

describe("recovery", () => {
  // TEST_SCENARIO: right after a boot the browser can fail to start a few times — a profile lock from the last boot, a display still coming up. The panel keeps watching and is told the browser is starting, later that it failed and why; the supervisor keeps retrying with a growing delay, and the panel goes live once a launch works.
  it("retries a failed launch while the panel keeps watching", async () => {
    const fake = fakeBrowser();
    fake.browser.launchFailures = 3;
    const browser = preview(fake);
    closers.push(() => browser.close());
    const panel = watching(browser);
    await until(() => panel.states().at(-1) === "ready");
    expect(fake.calls.filter(isLaunch)).toHaveLength(4);
    expect(panel.states()).toContain("failed");
    expect(
      panel.snapshots.find((s) => s.state === "failed")?.message,
    ).toContain("Chrome exited early");
  });

  // TEST_SCENARIO: the browser can die under an open panel — the agent closed it, Chrome crashed. Its CDP connection drops at once; the panel is told the browser is starting, and the supervisor launches it again.
  it("brings a dead browser back under an open panel", async () => {
    const fake = fakeBrowser();
    const browser = preview(fake);
    closers.push(() => browser.close());
    const panel = watching(browser);
    await until(() => panel.states().includes("ready"));

    fake.browser.die();
    await until(() => fake.calls.filter(isLaunch).length === 2 && launched());
    await until(() => panel.states().at(-1) === "ready");
    expect(panel.states().slice(-2)).toEqual(["starting", "ready"]);
  });

  // TEST_SCENARIO: a browser that stops answering — every check timing out — is stopped and launched again once it has been silent past the limit, rather than leaving the panel frozen until someone notices.
  it("restarts a browser that stopped answering", async () => {
    const fake = fakeBrowser();
    let stops = 0;
    const browser = preview(fake, {
      healthCheckMs: 20,
      unresponsiveRestartMs: 100,
      stopBrowser: async () => {
        stops++;
        fake.browser.alive = false;
        fake.browser.failPing = false;
      },
    });
    closers.push(() => browser.close());
    watching(browser);
    await until(launched);

    fake.browser.failPing = true;
    await until(() => stops === 1);
    await until(() => fake.calls.filter(isLaunch).length >= 2 && launched());
  });

  // TEST_SCENARIO: the agent keeps the browser busy — a loop of screenshots of a heavy Flash game — so the health check times out again and again. A busy browser is not a dead one: it is neither stopped nor relaunched before the silence limit, which killed the user's page when two timeouts were taken for a lost browser.
  it("leaves a busy browser alone until the silence limit", async () => {
    const fake = fakeBrowser();
    let stops = 0;
    const browser = preview(fake, {
      healthCheckMs: 20,
      unresponsiveRestartMs: 60_000,
      stopBrowser: async () => {
        stops++;
      },
    });
    closers.push(() => browser.close());
    watching(browser);
    await until(launched);
    fake.browser.failPing = true;
    await pause(300);
    expect(fake.browser.pings).toBeGreaterThan(3);
    expect(fake.calls.filter(isLaunch)).toHaveLength(1);
    expect(stops).toBe(0);
  });

  // TEST_SCENARIO: with the browser stuck, a health check never returns; the next checks must wait for it rather than pile up.
  it("runs one health check at a time", async () => {
    const fake = fakeBrowser();
    const browser = preview(fake, { healthCheckMs: 20 });
    closers.push(() => browser.close());
    const panel = watching(browser);
    await until(() => panel.states().includes("ready"));
    fake.browser.hangPing = true;
    const before = fake.browser.pings;
    await pause(300);
    expect(fake.browser.pings - before).toBeLessThanOrEqual(1);
  });

  // TEST_SCENARIO: Restart browser and Clear browser data stop the shared browser — on Clear, its profile is deleted — and the supervisor launches a fresh one. The panels keep watching through it and see the browser starting, then ready.
  it("restarts the browser without dropping the panels", async () => {
    const fake = fakeBrowser();
    let stops = 0;
    const browser = preview(fake, {
      stopBrowser: async () => {
        stops++;
        fake.browser.alive = false;
      },
    });
    closers.push(() => browser.close());
    const panel = watching(browser);
    await until(() => panel.states().includes("ready"));
    expect((await browser.act("restart")).ok).toBe(true);
    await until(() => fake.calls.filter(isLaunch).length === 2);
    await until(() => panel.states().at(-1) === "ready");
    expect(stops).toBe(1);
    expect(panel.states().slice(-2)).toEqual(["starting", "ready"]);
  });
});

describe("display stream", () => {
  // TEST_SCENARIO: the panel's stream client speaks the stream server's own protocol to Selkies in the sandbox; the runtime only relays its messages, text and binary as sent. The stream server can still be coming up — the runtime just started, or its display stack is being restarted — so a socket that arrives first is held, with what the client sent, until the server answers.
  it("relays the display socket, waiting for the stream server", async () => {
    const received: { data: string; binary: boolean }[] = [];
    let up: WebSocketServer | null = null;
    const port = await freePort();
    closers.push(
      () => new Promise<void>((r) => (up ? up.close(() => r()) : r())),
    );
    const fake = fakeBrowser();
    const connectTo = await displayHost(
      preview(fake, {
        displayStreamUrl: `ws://127.0.0.1:${port}/api/websockets`,
      }),
    );
    const { ws, messages } = await connectTo();
    ws.send("hello");
    ws.send(Buffer.from([1, 2, 3]));
    await pause(700);
    up = new WebSocketServer({ port, host: "127.0.0.1" });
    up.on("connection", (sock) => {
      sock.on("message", (d: Buffer, binary: boolean) =>
        received.push({ data: d.toString("hex"), binary }),
      );
      sock.send("MODE websockets");
      sock.send(Buffer.from([9, 9]));
    });
    await until(() => messages.length >= 2);
    expect(messages[0]).toBe("MODE websockets");
    expect(Buffer.isBuffer(messages[1])).toBe(true);
    await until(() => received.length === 2);
    expect(received).toEqual([
      { data: Buffer.from("hello").toString("hex"), binary: false },
      { data: "010203", binary: true },
    ]);
  });

  // TEST_SCENARIO: a client that keeps sending while the stream server is down must not grow the runtime's memory without bound: past a cap, its socket is closed, and the stream client reconnects on its own.
  it("closes a display socket that sends too much before the server answers", async () => {
    const port = await freePort();
    const fake = fakeBrowser();
    const connectTo = await displayHost(
      preview(fake, {
        displayStreamUrl: `ws://127.0.0.1:${port}/api/websockets`,
      }),
    );
    const { ws } = await connectTo();
    const closed = new Promise<number>((r) => ws.once("close", r));
    for (let i = 0; i < 5; i++) ws.send(Buffer.alloc(64 * 1024));
    expect(await closed).toBe(1013);
  });
});

describe("command queue", () => {
  // TEST_SCENARIO: agent-browser runs one command at a time anyway; sending it several at once only queued them inside it, past their deadlines. The runtime keeps its own commands in one line, and a failed command does not stop the ones after it.
  it("runs one command at a time and survives failures", async () => {
    const running: string[] = [];
    let overlap = false;
    const queue = createCommandQueue(async (args) => {
      if (running.length > 0) overlap = true;
      running.push(args[0]!);
      await pause(10);
      running.pop();
      if (args[0] === "bad") throw new Error("bad");
      return args[0]!;
    });
    const results = await Promise.allSettled([
      queue.run(["a"]),
      queue.run(["bad"]),
      queue.run(["c"]),
    ]);
    expect(overlap).toBe(false);
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    expect(queue.idle()).toBe(true);
  });
});

describe("display stack", () => {
  // TEST_SCENARIO: an image without the display stack — the stream server, the virtual display, the headed Chromium or the script that runs them — cannot show a browser panel.
  it("needs every part of the display stack", () => {
    expect(displayAvailable(() => true)).toBe(true);
    expect(displayAvailable((p) => p !== "/opt/selkies/bin/selkies")).toBe(
      false,
    );
  });
});

describe("stopping a stuck browser", () => {
  // TEST_SCENARIO: a page that stops answering leaves every browser command hanging. Commands get a short deadline — longer for the launch, which starts Chromium, and for closing it — so none can hang the panel for a minute.
  it("gives commands a short deadline, launching and closing a longer one", () => {
    expect(commandTimeoutMs(LAUNCH)).toBe(60_000);
    expect(commandTimeoutMs(["close"])).toBe(30_000);
    expect(commandTimeoutMs(["eval", "location.href"])).toBe(15_000);
  });

  // TEST_SCENARIO: stopping a stuck browser kills only what belongs to it — the Chromium on the shared profile — never another browser the agent started on a profile of its own.
  it("recognises only the shared browser's Chromium", () => {
    const profile = "/home/agent/.local/share/platform/browser";
    expect(
      isPreviewProcess(
        ["/opt/ms-playwright/chromium", `--user-data-dir=${profile}`].join(
          "\0",
        ),
        profile,
      ),
    ).toBe(true);
    expect(
      isPreviewProcess(
        [
          "/opt/ms-playwright/headless-shell",
          "--user-data-dir=/tmp/other",
        ].join("\0"),
        profile,
      ),
    ).toBe(false);
  });
});

describe("killablePreviewPids", () => {
  const profile = "/home/agent/.local/share/platform/browser";
  const proc = (pid: number, ...args: string[]) => ({
    pid,
    cmdline: args.join("\0"),
  });

  // TEST_SCENARIO: a stale daemon pid file can name any process of a new boot — the container's init, the entrypoint, the runtime itself. Only a pid whose command line really is agent-browser is killed, never pid 1, the runtime or its parent, and otherwise only the shared browser's own Chromium.
  it("never kills a stale pid file's stranger, init or the runtime", () => {
    const processes = [
      proc(1, "/usr/bin/catatonit", "--", "agent-entrypoint"),
      proc(40, "node", "dist/server.js"),
      proc(41, "bash", "-c", "harness"),
      proc(77, "/opt/ms-playwright/chromium", `--user-data-dir=${profile}`),
      proc(90, "/x/agent-browser-linux-x64"),
      proc(
        91,
        "/opt/ms-playwright/headless-shell",
        "--user-data-dir=/tmp/mine",
      ),
    ];
    const self = { pid: 40, ppid: 1 };
    expect(killablePreviewPids(processes, profile, 41, self)).toEqual([77]);
    expect(killablePreviewPids(processes, profile, 1, self)).toEqual([77]);
    expect(killablePreviewPids(processes, profile, 90, self)).toEqual([77, 90]);
  });
});
