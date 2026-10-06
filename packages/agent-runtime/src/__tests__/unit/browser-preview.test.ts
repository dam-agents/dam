import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import {
  createServer as createTcpServer,
  connect,
  type Socket,
} from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
  VIDEO_UNAVAILABLE,
  commandTimeoutMs,
  createCommandQueue,
  isPreviewProcess,
  killablePreviewPids,
  parseViewport,
  type BrowserVideo,
  createBrowserPreview,
  parseControl,
  previewUrl,
  type BrowserPreview,
} from "../../modules/browser-preview.js";

// TEST_OVERVIEW: The browser preview gives every open browser panel a live view of the agent's one shared `preview` browser. A single supervisor owns that browser for all panels: it launches it once, runs browser commands one at a time, sets the viewport to the newest panel size, runs one video encoder whose frames go to every panel, and brings the browser back — without dropping the panels — when it fails to start, dies, or stops answering. Panels are told the browser's state instead of being disconnected.

const closers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function fakeStream() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const received: string[] = [];
  const sockets: WebSocket[] = [];
  wss.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("message", (d) => received.push(d.toString()));
    ws.send(JSON.stringify({ type: "frame", seq: 1, data: "AAAA" }));
  });
  closers.push(() => new Promise<void>((r) => wss.close(() => r())));
  return {
    port: (wss.address() as { port: number }).port,
    received,
    sockets,
    dropAll: () => {
      for (const s of sockets.splice(0)) s.terminate();
    },
  };
}

function fakeBrowser(port: number) {
  const calls: string[][] = [];
  const browser = {
    alive: false,
    viewport: "1280x720@1",
    launchFailures: 0,
    hangEval: false,
    failEval: false,
  };
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "launch") {
      if (browser.launchFailures > 0) {
        browser.launchFailures--;
        throw new Error("Chrome exited early");
      }
      browser.alive = true;
      return "";
    }
    if (!browser.alive) throw new Error("no browser running");
    if (args[0] === "stream")
      return JSON.stringify({ success: true, data: { port } });
    if (args[0] === "screen") browser.viewport = `${args[1]}x${args[2]}@1`;
    if (args[0] === "eval") {
      if (browser.hangEval) return new Promise<string>(() => {});
      if (browser.failEval) throw new Error("eval timed out");
      if (args[1]?.startsWith("innerWidth"))
        return JSON.stringify(browser.viewport);
    }
    return "";
  };
  return { calls, run, browser };
}

function fakeVideo() {
  const starts: { width: number; height: number }[] = [];
  const stops: number[] = [];
  let emit: ((frame: Buffer, key: boolean) => void) | null = null;
  let exit: (() => void) | null = null;
  const video: BrowserVideo = {
    available: () => true,
    start: (opts) => {
      const n = starts.push({ width: opts.width, height: opts.height });
      emit = opts.onFrame;
      exit = opts.onExit;
      return { stop: () => stops.push(n) };
    },
  };
  return {
    video,
    starts,
    stops,
    emit: (f: Buffer, k: boolean) => emit?.(f, k),
    crash: () => exit?.(),
  };
}

async function host(preview: BrowserPreview) {
  const wss = new WebSocketServer({ noServer: true });
  const server: Server = createServer();
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url!, "http://x");
    wss.handleUpgrade(req, socket, head, (ws) =>
      preview.attach(ws, url.searchParams),
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  closers.push(() => {
    preview.close();
    return new Promise<void>((r) => server.close(() => r()));
  });
  const port = (server.address() as { port: number }).port;
  return async (query: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query}`);
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
  run: (args: string[]) => Promise<string>,
  extra: Partial<Parameters<typeof createBrowserPreview>[0]> = {},
) {
  return createBrowserPreview({
    run,
    profileDir: "/tmp/x",
    video: fakeVideo().video,
    stopBrowser: async () => {},
    retryDelaysMs: [10],
    log: () => {},
    ...extra,
  });
}

const resize = (ws: WebSocket, width: number, height: number) =>
  ws.send(JSON.stringify({ type: "resize", width, height }));

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
  // TEST_SCENARIO: Only the panel's own control messages are taken out of the stream; input events and anything malformed pass on to agent-browser untouched.
  it("recognises navigation, clear_data and a bounded resize only", () => {
    expect(parseControl('{"type":"navigate","url":"http://a"}')).toEqual({
      type: "navigate",
      url: "http://a",
    });
    expect(parseControl('{"type":"reload"}')).toEqual({ type: "reload" });
    expect(parseControl('{"type":"back"}')).toEqual({ type: "back" });
    expect(parseControl('{"type":"forward"}')).toEqual({ type: "forward" });
    expect(parseControl('{"type":"clear_data"}')).toEqual({
      type: "clear_data",
    });
    expect(parseControl('{"type":"resize","width":900,"height":640}')).toEqual({
      type: "resize",
      width: 900,
      height: 640,
      scale: 1,
    });
    expect(
      parseControl('{"type":"resize","width":900,"height":640,"scale":2}'),
    ).toEqual({ type: "resize", width: 900, height: 640, scale: 2 });
    expect(
      parseControl('{"type":"resize","width":900,"height":640,"scale":3}'),
    ).toBeNull();
    expect(
      parseControl('{"type":"resize","width":10,"height":640}'),
    ).toBeNull();
    expect(
      parseControl('{"type":"resize","width":900.5,"height":640}'),
    ).toBeNull();
    expect(parseControl('{"type":"input_mouse"}')).toBeNull();
    expect(parseControl('{"type":"navigate"}')).toBeNull();
    expect(parseControl("{")).toBeNull();
  });
});

describe("browser preview", () => {
  // TEST_SCENARIO: A panel opens on an address. The browser is launched and navigated there, agent-browser's own screencast is stopped and any screencast frame still sent is dropped, address updates reach the panel, and the panel's input reaches the browser.
  it("launches, navigates, pipes address updates and input", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeBrowser(stream.port);
    const connect = await host(preview(run));
    const { ws, messages, states } = await connect(
      "url=http%3A%2F%2F127.0.0.1%3A5173%2F",
    );
    await until(() => stream.sockets.length === 1);
    expect(calls[0]).toEqual(["launch"]);
    await until(() =>
      calls.some(
        (c) =>
          c[0] === "eval" &&
          c[1] === 'location.href = "http://127.0.0.1:5173/"',
      ),
    );
    expect(states()).toContain("ready");
    expect(stream.received[0]).toBe(
      JSON.stringify({ type: "screencast_stop" }),
    );

    stream.sockets[0]!.send(JSON.stringify({ type: "url", url: "http://a/" }));
    await until(() =>
      messages.some((m) => typeof m === "string" && m.includes("http://a/")),
    );
    expect(
      messages.some((m) => typeof m === "string" && m.includes('"frame"')),
    ).toBe(false);

    ws.send(JSON.stringify({ type: "input_mouse", x: 1, y: 2 }));
    await until(() => stream.received.some((r) => r.includes("input_mouse")));
  });

  // TEST_SCENARIO: an agent whose image lacks the virtual display or ffmpeg cannot stream; the panel is told so in words and the connection closes, rather than showing a blank panel.
  it("refuses a panel when the image cannot stream video", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeBrowser(stream.port);
    const connect = await host(
      preview(run, {
        video: { ...fakeVideo().video, available: () => false },
      }),
    );
    const { ws, json } = await connect("");
    const code = await new Promise<number>((r) => ws.once("close", r));
    expect(code).toBe(1011);
    expect(json()).toContainEqual({
      type: "preview_error",
      message: VIDEO_UNAVAILABLE,
    });
    expect(calls).toEqual([]);
  });

  // TEST_SCENARIO: A panel that reconnects without an address must not reload the page the user was on: the browser is only launched or found, never navigated.
  it("reattaches without navigating when no address is given", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeBrowser(stream.port);
    const connect = await host(preview(run));
    await connect("");
    await until(() => stream.sockets.length === 1);
    expect(calls.some((c) => c[0] === "open" || c[0] === "eval")).toBe(false);
  });

  // TEST_SCENARIO: An address given on connect that is not http or https is refused before any browser command runs.
  it("refuses a non-web address on connect", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeBrowser(stream.port);
    const connect = await host(preview(run));
    const { ws } = await connect("url=file%3A%2F%2F%2Fetc%2Fpasswd");
    const code = await new Promise<number>((r) => ws.once("close", r));
    expect(code).toBe(1008);
    expect(calls).toEqual([]);
  });

  // TEST_SCENARIO: The address bar sends navigate, reload, back and forward as control messages. They run inside the page rather than through `open`, which holds agent-browser's one-at-a-time command queue until the page has loaded — a slow page held every resize behind it for up to 20 seconds. A non-web address is answered with an error message rather than opened.
  it("runs navigation in the page and refuses non-web addresses", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeBrowser(stream.port);
    const connect = await host(preview(run));
    const { ws, json } = await connect("");
    await until(() => stream.sockets.length === 1);

    ws.send(JSON.stringify({ type: "navigate", url: "https://example.com" }));
    ws.send(JSON.stringify({ type: "reload" }));
    ws.send(JSON.stringify({ type: "back" }));
    ws.send(JSON.stringify({ type: "forward" }));
    ws.send(JSON.stringify({ type: "navigate", url: "file:///etc/passwd" }));
    await until(() => json().some((m) => m.type === "preview_error"));
    await until(() => calls.filter((c) => c[0] === "eval").length >= 4);

    expect(calls).toContainEqual([
      "eval",
      'location.href = "https://example.com/"',
    ]);
    expect(calls).toContainEqual(["eval", "location.reload()"]);
    expect(calls).toContainEqual(["eval", "history.back()"]);
    expect(calls).toContainEqual(["eval", "history.forward()"]);
    expect(calls.some((c) => c[0] === "open")).toBe(false);
    expect(calls.flat()).not.toContain("file:///etc/passwd");
    expect(stream.received).toEqual([
      JSON.stringify({ type: "screencast_stop" }),
    ]);
  });

  // TEST_SCENARIO: A Chromium costs the agent memory, so the browser is closed once nobody has watched it for the idle window; a viewer who comes back inside the window keeps it open.
  it("closes the browser after the last viewer leaves", async () => {
    const stream = await fakeStream();
    const { run } = fakeBrowser(stream.port);
    let stops = 0;
    const connect = await host(
      preview(run, {
        idleCloseMs: 80,
        stopBrowser: async () => {
          stops++;
        },
      }),
    );
    const first = await connect("");
    await until(() => stream.sockets.length === 1);
    first.ws.close();
    await pause(30);
    const second = await connect("");
    await pause(100);
    expect(stops).toBe(0);
    second.ws.close();
    await until(() => stops === 1);
  });
});

describe("one browser for every panel", () => {
  // TEST_SCENARIO: two panels — two tabs, or a reconnect racing the old socket — must not launch the browser twice; launching twice is what crashed Chrome on its locked profile. They share one launch, one stream connection and one encoder, a newcomer gets a fresh keyframe, and every frame goes to both.
  it("shares one launch and one encoder between panels", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeBrowser(stream.port);
    const fake = fakeVideo();
    const connect = await host(preview(run, { video: fake.video }));
    const a = await connect("");
    const b = await connect("");
    resize(a.ws, 900, 700);
    await until(() => fake.starts.length === 1);
    expect(calls.filter((c) => c[0] === "launch")).toHaveLength(1);
    expect(stream.sockets).toHaveLength(1);

    const c = await connect("");
    await until(() => fake.starts.length === 2);
    expect(fake.stops).toContain(1);

    fake.emit(Buffer.from("key"), true);
    for (const panel of [a, b, c])
      await until(() =>
        panel.messages.some(
          (m) => Buffer.isBuffer(m) && m.toString() === "key",
        ),
      );
  });

  // TEST_SCENARIO: dragging the panel's edge sends a size each time it settles, and agent-browser runs one command at a time. While a size is being set, newer ones replace each other, and only the newest is set next, with one encoder start.
  it("sets only the newest size while one is in flight", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeBrowser(stream.port);
    let release: () => void = () => {};
    const slowRun = async (args: string[]) => {
      if (args[0] === "screen" && calls.every((c) => c[0] !== "screen"))
        await new Promise<void>((r) => (release = r));
      return run(args);
    };
    const fake = fakeVideo();
    const connect = await host(preview(slowRun, { video: fake.video }));
    const { ws } = await connect("");
    await until(() => stream.sockets.length === 1);

    resize(ws, 900, 700);
    await pause(50);
    for (const width of [800, 700, 600]) resize(ws, width, 500);
    await pause(50);
    release();

    await until(() => fake.starts.length === 1);
    await pause(50);
    expect(calls.filter((c) => c[0] === "screen")).toEqual([
      ["screen", "900", "700"],
      ["screen", "600", "500"],
    ]);
    expect(fake.starts).toEqual([{ width: 600, height: 500 }]);
  });
});

describe("recovery", () => {
  // TEST_SCENARIO: right after a boot the browser can fail to start a few times — a profile lock from the last boot, a second launcher. The panel stays connected and is told the browser is starting, later that it failed; the supervisor keeps retrying with a growing delay, and the panel goes live once a launch works, without reconnecting.
  it("retries a failed launch while the panel stays connected", async () => {
    const stream = await fakeStream();
    const { calls, run, browser } = fakeBrowser(stream.port);
    browser.launchFailures = 3;
    const fake = fakeVideo();
    const connect = await host(preview(run, { video: fake.video }));
    const { ws, states, json } = await connect("");
    resize(ws, 900, 700);
    await until(() => fake.starts.length === 1);
    expect(calls.filter((c) => c[0] === "launch")).toHaveLength(4);
    expect(states()).toEqual(["starting", "failed", "starting", "ready"]);
    expect(json().find((m) => m.state === "failed")?.message).toContain(
      "Chrome exited early",
    );
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // TEST_SCENARIO: the browser can die under an open panel — the agent closed it, Chrome crashed, the display went away. Its stream connection closes; the panel is not dropped but told the browser is starting, and the supervisor launches it again, puts the panel's size back and restarts the encoder.
  it("brings a dead browser back under an open panel", async () => {
    const stream = await fakeStream();
    const { calls, run, browser } = fakeBrowser(stream.port);
    const fake = fakeVideo();
    const connect = await host(preview(run, { video: fake.video }));
    const { ws, states } = await connect("");
    resize(ws, 900, 700);
    await until(() => fake.starts.length === 1);

    browser.alive = false;
    browser.viewport = "1280x720@1";
    stream.dropAll();
    await until(() => fake.starts.length === 2);
    expect(calls.filter((c) => c[0] === "launch")).toHaveLength(2);
    expect(browser.viewport).toBe("900x700@1");
    expect(states().slice(-2)).toEqual(["starting", "ready"]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // TEST_SCENARIO: a browser that stops answering — every command timing out — is restarted once it has been silent past the limit, rather than leaving the panel frozen until someone notices.
  it("restarts a browser that stopped answering", async () => {
    const stream = await fakeStream();
    const { run, browser } = fakeBrowser(stream.port);
    const fake = fakeVideo();
    let stops = 0;
    const connect = await host(
      preview(run, {
        video: fake.video,
        healthCheckMs: 20,
        unresponsiveRestartMs: 100,
        stopBrowser: async () => {
          stops++;
          browser.alive = false;
          browser.failEval = false;
          stream.dropAll();
        },
      }),
    );
    const { ws } = await connect("");
    resize(ws, 900, 700);
    await until(() => fake.starts.length === 1);

    browser.failEval = true;
    await until(() => stops === 1);
    await until(() => fake.starts.length === 2);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // TEST_SCENARIO: with the browser stuck, a health check never returns; the next checks must wait for it rather than pile up — piled-up commands are what starved the sandbox.
  it("runs one health check at a time", async () => {
    const stream = await fakeStream();
    const { calls, run, browser } = fakeBrowser(stream.port);
    const fake = fakeVideo();
    const connect = await host(
      preview(run, { video: fake.video, healthCheckMs: 20 }),
    );
    const { ws } = await connect("");
    resize(ws, 900, 700);
    await until(() => fake.starts.length === 1);
    browser.hangEval = true;
    await pause(300);
    expect(calls.filter((c) => c[0] === "eval")).toHaveLength(1);
  });

  // TEST_SCENARIO: the agent launched the browser itself, or reset its viewport, so the browser runs at another size than the panel's and the encoder captures only part of the page. The health check reads the browser's real viewport, puts the panel's size back, and restarts the encoder at it.
  it("puts the panel's size back when the browser is at another one", async () => {
    const stream = await fakeStream();
    const { run, browser } = fakeBrowser(stream.port);
    const fake = fakeVideo();
    const connect = await host(
      preview(run, { video: fake.video, healthCheckMs: 30 }),
    );
    const { ws } = await connect("");
    resize(ws, 900, 700);
    await until(() => fake.starts.length === 1);
    browser.viewport = "1280x720@1";
    await until(() => fake.starts.length === 2);
    expect(browser.viewport).toBe("900x700@1");
  });

  // TEST_SCENARIO: a size that fails to apply — the browser busy past the command's deadline — is not the user's error to read: the panel stayed on "set timed out" long after. It is logged, and the health check sets the size again once the browser answers.
  it("retries a size that failed without telling the panel", async () => {
    const stream = await fakeStream();
    const { calls, run, browser } = fakeBrowser(stream.port);
    let failing = true;
    const flaky = async (args: string[]) => {
      if (failing && args[0] === "screen") {
        calls.push(args);
        throw new Error("set timed out");
      }
      return run(args);
    };
    const fake = fakeVideo();
    const connect = await host(
      preview(flaky, { video: fake.video, healthCheckMs: 30 }),
    );
    const { ws, json } = await connect("");
    resize(ws, 900, 700);
    await until(() => calls.some((c) => c[0] === "screen"));
    failing = false;
    await until(() => fake.starts.length === 1);
    expect(browser.viewport).toBe("900x700@1");
    expect(json().some((m) => m.type === "preview_error")).toBe(false);
  });

  // TEST_SCENARIO: the encoder can exit on its own — the display restarted, ffmpeg crashed. The supervisor starts it again after a short pause, so the panel's picture comes back by itself.
  it("restarts an encoder that exited", async () => {
    const stream = await fakeStream();
    const { run } = fakeBrowser(stream.port);
    const fake = fakeVideo();
    const connect = await host(preview(run, { video: fake.video }));
    const { ws } = await connect("");
    resize(ws, 900, 700);
    await until(() => fake.starts.length === 1);
    fake.crash();
    await until(() => fake.starts.length === 2, 3_000);
  });

  // TEST_SCENARIO: Restart browser and Clear browser data stop the shared browser — on Clear, its profile is deleted — and the supervisor launches a fresh one. The panels stay connected through it and see the browser starting, then ready.
  it("restarts the browser without dropping the panels", async () => {
    const stream = await fakeStream();
    const { calls, run, browser } = fakeBrowser(stream.port);
    const fake = fakeVideo();
    let stops = 0;
    const connect = await host(
      preview(run, {
        video: fake.video,
        stopBrowser: async () => {
          stops++;
          browser.alive = false;
          stream.dropAll();
        },
      }),
    );
    const { ws, states } = await connect("");
    resize(ws, 900, 700);
    await until(() => fake.starts.length === 1);
    ws.send(JSON.stringify({ type: "restart_browser" }));
    await until(() => fake.starts.length === 2);
    expect(stops).toBe(1);
    expect(calls.filter((c) => c[0] === "launch")).toHaveLength(2);
    expect(states().slice(-2)).toEqual(["starting", "ready"]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("VNC", () => {
  // TEST_SCENARIO: a panel in VNC mode opens a second socket with vnc=1 and speaks the VNC protocol to the virtual display's own VNC server: the runtime only pipes bytes both ways. The display comes up with the browser, so a socket that arrives first is held, with what the viewer sent, until the server answers.
  it("pipes a vnc socket to the display, waiting for it to come up", async () => {
    const received: Buffer[] = [];
    const server = createTcpServer((sock) => {
      sock.on("data", (d: Buffer) => received.push(d));
      sock.write("RFB 003.008\n");
    });
    let up = false;
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    closers.push(() => new Promise<void>((r) => server.close(() => r())));
    const port = (server.address() as { port: number }).port;
    const stream = await fakeStream();
    const { run } = fakeBrowser(stream.port);
    const connectTo = await host(
      preview(run, {
        connectDisplay: (): Socket => connect(up ? port : 1, "127.0.0.1"),
      }),
    );
    const { ws, messages } = await connectTo("vnc=1");
    ws.send(Buffer.from("RFB 003.008\n"));
    await pause(700);
    up = true;
    await until(() =>
      messages.some(
        (m) => Buffer.isBuffer(m) && m.toString().startsWith("RFB"),
      ),
    );
    await until(() => Buffer.concat(received).toString() === "RFB 003.008\n");
  });
});

describe("VNC and video together", () => {
  // TEST_SCENARIO: a panel switched to VNC sizes the screen itself, through the VNC protocol. Its control socket says no_video, so the runtime stops the encoder and stops putting a video panel's size back — otherwise the health check would undo every VNC resize.
  it("stops the encoder and the size check when a panel asks for no video", async () => {
    const stream = await fakeStream();
    const { calls, run, browser } = fakeBrowser(stream.port);
    const fake = fakeVideo();
    const connectTo = await host(
      preview(run, { video: fake.video, healthCheckMs: 20 }),
    );
    const { ws } = await connectTo("");
    resize(ws, 900, 700);
    await until(() => fake.starts.length === 1);
    ws.send(JSON.stringify({ type: "no_video" }));
    await until(() => fake.stops.includes(1));
    browser.viewport = "1400x900@1";
    const screens = calls.filter((c) => c[0] === "screen").length;
    await pause(200);
    expect(calls.filter((c) => c[0] === "screen")).toHaveLength(screens);
    expect(fake.starts).toHaveLength(1);
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

describe("viewport", () => {
  it("reads agent-browser's eval output", () => {
    expect(parseViewport('"570x774@2"')).toEqual({
      width: 570,
      height: 774,
      scale: 2,
    });
    expect(parseViewport("")).toBeNull();
  });
});

describe("stopping a stuck browser", () => {
  // TEST_SCENARIO: a page that stops answering leaves every browser command hanging. Commands get a short deadline — longer for open, which loads a page, and for launching and shutting the browser down — so none can hang the panel for a minute.
  it("gives commands a short deadline, loading and lifecycle a longer one", () => {
    expect(commandTimeoutMs(["open", "http://a/"])).toBe(45_000);
    expect(commandTimeoutMs(["launch"])).toBe(60_000);
    expect(commandTimeoutMs(["shutdown"])).toBe(30_000);
    expect(commandTimeoutMs(["screen", "1", "1"])).toBe(15_000);
  });

  // TEST_SCENARIO: stopping the panel's browser kills only what belongs to it — the Chromium on the panel's profile and agent-browser processes for the preview session — never the agent's own browser sessions or anything else.
  it("recognises only the preview browser's processes", () => {
    const profile = "/home/agent/.local/share/platform/browser-preview";
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
        ["node", "/x/agent-browser", "--session", "preview", "set"].join("\0"),
        profile,
      ),
    ).toBe(true);
    expect(
      isPreviewProcess(
        ["node", "/x/agent-browser", "--session", "mine", "open"].join("\0"),
        profile,
      ),
    ).toBe(false);
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
  const profile = "/home/agent/.local/share/platform/browser-preview";
  const proc = (pid: number, ...args: string[]) => ({
    pid,
    cmdline: args.join("\0"),
  });

  // TEST_SCENARIO: agent-browser's pid file lives in the agent's home, which outlives a restart, so after one it can name any process of the new boot — the container's init, the entrypoint, the runtime itself. Killing it took the whole agent down. Only a pid whose command line really is agent-browser is killed, never pid 1, the runtime or its parent, and otherwise only processes that are the panel's own browser.
  it("never kills a stale pid file's stranger, init or the runtime", () => {
    const processes = [
      proc(1, "/usr/bin/catatonit", "--", "agent-entrypoint"),
      proc(40, "node", "dist/server.js"),
      proc(41, "bash", "-c", "harness"),
      proc(77, "/opt/ms-playwright/chromium", `--user-data-dir=${profile}`),
      proc(78, "/x/agent-browser", "--session", "preview", "set"),
      proc(90, "/x/agent-browser-linux-x64"),
      proc(
        91,
        "/opt/ms-playwright/headless-shell",
        "--user-data-dir=/tmp/mine",
      ),
    ];
    const self = { pid: 40, ppid: 1 };
    expect(killablePreviewPids(processes, profile, 41, self)).toEqual([77, 78]);
    expect(killablePreviewPids(processes, profile, 1, self)).toEqual([77, 78]);
    expect(killablePreviewPids(processes, profile, 90, self)).toEqual([
      77, 78, 90,
    ]);
  });
});
