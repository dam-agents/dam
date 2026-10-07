import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { WatchPages } from "../../modules/browser-cdp.js";
import {
  DISPLAY_UNAVAILABLE,
  LAUNCH,
  commandTimeoutMs,
  createCommandQueue,
  displayAvailable,
  isPreviewProcess,
  killablePreviewPids,
  createBrowserPreview,
  parseControl,
  previewUrl,
  type BrowserPreview,
} from "../../modules/browser-preview.js";

// TEST_OVERVIEW: The browser panel shows the agent's one browser — the one every plain agent-browser command drives — streamed from its virtual display. A single supervisor keeps that browser up for every open panel: it launches it once, runs its own browser commands one at a time, tells the panels the page's address and the browser's state, and brings the browser back — without dropping the panels — when it fails to start, dies, or stops answering. A panel's display socket is relayed to the display's stream server.

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

async function host(preview: BrowserPreview) {
  const wss = new WebSocketServer({ noServer: true });
  const server: Server = createServer();
  server.on("upgrade", (req, socket, head) => {
    const display = req.url?.startsWith("/display");
    wss.handleUpgrade(req, socket, head, (ws) =>
      display ? preview.attachDisplay(ws) : preview.attach(ws),
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  closers.push(() => {
    preview.close();
    return new Promise<void>((r) => server.close(() => r()));
  });
  const port = (server.address() as { port: number }).port;
  return async (path = "/") => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    closers.push(() => ws.terminate());
    const messages: (string | Buffer)[] = [];
    ws.on("message", (d: Buffer, isBinary) =>
      messages.push(isBinary ? d : d.toString()),
    );
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    const json = () =>
      messages
        .filter((m): m is string => typeof m === "string")
        .map((m) => JSON.parse(m) as Record<string, unknown>);
    const states = () =>
      json()
        .filter((m) => m.type === "browser_state")
        .map((m) => m.state);
    return { ws, messages, json, states };
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

describe("parseControl", () => {
  // TEST_SCENARIO: Only the panel's own control messages are acted on; anything else or malformed is ignored.
  it("recognises navigation and the browser's restart only", () => {
    expect(parseControl('{"type":"navigate","url":"http://a"}')).toEqual({
      type: "navigate",
      url: "http://a",
    });
    for (const type of [
      "reload",
      "back",
      "forward",
      "clear_data",
      "restart_browser",
    ])
      expect(parseControl(JSON.stringify({ type }))).toEqual({ type });
    expect(
      parseControl('{"type":"resize","width":900,"height":640}'),
    ).toBeNull();
    expect(parseControl('{"type":"navigate"}')).toBeNull();
    expect(parseControl("{")).toBeNull();
  });
});

describe("browser preview", () => {
  // TEST_SCENARIO: A panel connects. The browser is launched through agent-browser — the same browser the agent's own commands drive — and the panel is told it is ready and what page it shows. An address from the panel opens over CDP, and the page's state reaches the panel as the browser reports it, with no polling.
  it("launches, navigates and reports the page", async () => {
    const fake = fakeBrowser();
    const connect = await host(preview(fake));
    const { ws, states, json } = await connect();
    await until(launched);
    expect(isLaunch(fake.calls[0]!)).toBe(true);
    await until(() => states().includes("ready"));
    expect(json()).toContainEqual(
      expect.objectContaining({ type: "page", url: "about:blank" }),
    );
    ws.send(JSON.stringify({ type: "navigate", url: "http://127.0.0.1:5173" }));
    await until(() =>
      json().some(
        (m) => m.type === "page" && m.url === "http://127.0.0.1:5173/",
      ),
    );
    expect(fake.calls).toContainEqual([
      "page",
      "navigate",
      "http://127.0.0.1:5173/",
    ]);
  });

  // TEST_SCENARIO: an agent whose image lacks the display stack cannot show its browser; both of the panel's sockets are told so in words and closed, rather than showing a blank panel, and no browser is started.
  it("refuses a panel when the image has no display stack", async () => {
    const fake = fakeBrowser();
    const connect = await host(preview(fake, { available: () => false }));
    for (const path of ["/", "/display"]) {
      const { ws, json } = await connect(path);
      const code = await new Promise<number>((r) => ws.once("close", r));
      expect(code).toBe(1011);
      expect(json()).toContainEqual({
        type: "preview_error",
        message: DISPLAY_UNAVAILABLE,
      });
    }
    expect(fake.calls).toEqual([]);
  });

  // TEST_SCENARIO: The toolbar's navigate, reload, stop, back and forward run on the page over CDP, never through agent-browser, whose one-at-a-time queue may hold the agent's own commands. A non-web address is answered with an error rather than opened.
  it("runs the toolbar on the page and refuses non-web addresses", async () => {
    const fake = fakeBrowser();
    const connect = await host(preview(fake));
    const { ws, json, states } = await connect();
    await until(() => states().includes("ready"));

    for (const type of ["reload", "stop", "back", "forward"])
      ws.send(JSON.stringify({ type }));
    ws.send(JSON.stringify({ type: "navigate", url: "file:///etc/passwd" }));
    await until(() => json().some((m) => m.type === "preview_error"));
    await until(() => fake.calls.filter((c) => c[0] === "page").length >= 4);

    for (const action of ["reload", "stop", "back", "forward"])
      expect(fake.calls).toContainEqual(["page", action]);
    expect(fake.calls.flat()).not.toContain("file:///etc/passwd");
    expect(fake.calls.filter((c) => c[0] === "eval")).toEqual([]);
  });

  // TEST_SCENARIO: an address sent before the browser is up — the panel opened on a link — is opened once it is.
  it("opens an address sent while the browser starts", async () => {
    const fake = fakeBrowser();
    fake.browser.launchFailures = 1;
    const connect = await host(preview(fake));
    const { ws, states } = await connect();
    ws.send(JSON.stringify({ type: "navigate", url: "http://a/" }));
    await until(() => states().at(-1) === "ready");
    await until(() =>
      fake.calls.some((c) => c[0] === "page" && c[2] === "http://a/"),
    );
  });

  // TEST_SCENARIO: the agent may be using the browser while no panel is open, so the last panel closing leaves it running; the supervisor only stops watching it.
  it("leaves the browser running when the last panel closes", async () => {
    const fake = fakeBrowser();
    let stops = 0;
    const connect = await host(
      preview(fake, {
        healthCheckMs: 20,
        stopBrowser: async () => {
          stops++;
        },
      }),
    );
    const { ws } = await connect();
    await until(launched);
    ws.close();
    await pause(100);
    const pings = fake.browser.pings;
    await pause(100);
    expect(stops).toBe(0);
    expect(fake.browser.pings).toBe(pings);
  });
});

describe("one browser for every panel", () => {
  // TEST_SCENARIO: two panels — two tabs, or a reconnect racing the old socket — must not launch the browser twice; they share one launch and both are told it is ready.
  it("shares one launch between panels", async () => {
    const fake = fakeBrowser();
    const connect = await host(preview(fake));
    const a = await connect();
    const b = await connect();
    await until(() => a.states().includes("ready"));
    await until(() => b.states().includes("ready"));
    expect(fake.calls.filter(isLaunch)).toHaveLength(1);
  });
});

describe("recovery", () => {
  // TEST_SCENARIO: right after a boot the browser can fail to start a few times — a profile lock from the last boot, a display still coming up. The panel stays connected and is told the browser is starting, later that it failed; the supervisor keeps retrying with a growing delay, and the panel goes live once a launch works, without reconnecting.
  it("retries a failed launch while the panel stays connected", async () => {
    const fake = fakeBrowser();
    fake.browser.launchFailures = 3;
    const connect = await host(preview(fake));
    const { ws, states, json } = await connect();
    await until(() => states().at(-1) === "ready");
    expect(fake.calls.filter(isLaunch)).toHaveLength(4);
    expect(states()).toEqual(["starting", "failed", "starting", "ready"]);
    expect(json().find((m) => m.state === "failed")?.message).toContain(
      "Chrome exited early",
    );
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // TEST_SCENARIO: the browser can die under an open panel — the agent closed it, Chrome crashed. Its CDP connection drops at once; the panel is not dropped but told the browser is starting, and the supervisor launches it again.
  it("brings a dead browser back under an open panel", async () => {
    const fake = fakeBrowser();
    const connect = await host(preview(fake));
    const { ws, states } = await connect();
    await until(() => states().includes("ready"));

    fake.browser.die();
    await until(() => fake.calls.filter(isLaunch).length === 2 && launched());
    await until(() => states().at(-1) === "ready");
    expect(states().slice(-2)).toEqual(["starting", "ready"]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // TEST_SCENARIO: a browser that stops answering — every check timing out — is stopped and launched again once it has been silent past the limit, rather than leaving the panel frozen until someone notices.
  it("restarts a browser that stopped answering", async () => {
    const fake = fakeBrowser();
    let stops = 0;
    const connect = await host(
      preview(fake, {
        healthCheckMs: 20,
        unresponsiveRestartMs: 100,
        stopBrowser: async () => {
          stops++;
          fake.browser.alive = false;
          fake.browser.failPing = false;
        },
      }),
    );
    const { ws } = await connect();
    await until(launched);

    fake.browser.failPing = true;
    await until(() => stops === 1);
    await until(() => fake.calls.filter(isLaunch).length >= 2 && launched());
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // TEST_SCENARIO: the agent keeps the browser busy — a loop of screenshots of a heavy Flash game — so the health check times out again and again. A busy browser is not a dead one: it is neither stopped nor relaunched before the silence limit, which killed the user's page when two timeouts were taken for a lost browser.
  it("leaves a busy browser alone until the silence limit", async () => {
    const fake = fakeBrowser();
    let stops = 0;
    const connect = await host(
      preview(fake, {
        healthCheckMs: 20,
        unresponsiveRestartMs: 60_000,
        stopBrowser: async () => {
          stops++;
        },
      }),
    );
    await connect();
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
    const connect = await host(preview(fake, { healthCheckMs: 20 }));
    const { states } = await connect();
    await until(() => states().includes("ready"));
    fake.browser.hangPing = true;
    const before = fake.browser.pings;
    await pause(300);
    expect(fake.browser.pings - before).toBeLessThanOrEqual(1);
  });

  // TEST_SCENARIO: Restart browser and Clear browser data stop the shared browser — on Clear, its profile is deleted — and the supervisor launches a fresh one. The panels stay connected through it and see the browser starting, then ready.
  it("restarts the browser without dropping the panels", async () => {
    const fake = fakeBrowser();
    let stops = 0;
    const connect = await host(
      preview(fake, {
        stopBrowser: async () => {
          stops++;
          fake.browser.alive = false;
        },
      }),
    );
    const { ws, states } = await connect();
    await until(() => states().includes("ready"));
    ws.send(JSON.stringify({ type: "restart_browser" }));
    await until(() => fake.calls.filter(isLaunch).length === 2);
    await until(() => states().at(-1) === "ready");
    expect(stops).toBe(1);
    expect(states().slice(-2)).toEqual(["starting", "ready"]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
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
    const connectTo = await host(
      preview(fake, {
        displayStreamUrl: `ws://127.0.0.1:${port}/api/websockets`,
      }),
    );
    const { ws, messages } = await connectTo("/display");
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
    const connectTo = await host(
      preview(fake, {
        displayStreamUrl: `ws://127.0.0.1:${port}/api/websockets`,
      }),
    );
    const { ws } = await connectTo("/display");
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
