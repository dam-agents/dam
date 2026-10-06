import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  browserCommandLine,
  VIDEO_UNAVAILABLE,
  commandTimeoutMs,
  isPreviewProcess,
  killablePreviewPids,
  parseViewport,
  type BrowserVideo,
  createBrowserPreview,
  parseControl,
  previewUrl,
  type BrowserPreview,
} from "../../modules/browser-preview.js";

// TEST_OVERVIEW: The browser preview gives the chat's browser panel a live view of the agent's shared `preview` agent-browser session. It opens the session at the asked address, pipes the session's stream server (frames out, input in) to the panel, handles the panel's own navigate, reload and clear-data messages itself, and closes the browser a while after the last viewer leaves.

const closers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function fakeStream() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const received: string[] = [];
  const urls: string[] = [];
  const sockets: WebSocket[] = [];
  wss.on("connection", (ws, req) => {
    sockets.push(ws);
    urls.push(req.url ?? "");
    ws.on("message", (d) => received.push(d.toString()));
    ws.send(JSON.stringify({ type: "frame", seq: 1, data: "AAAA" }));
  });
  closers.push(() => new Promise<void>((r) => wss.close(() => r())));
  return {
    port: (wss.address() as { port: number }).port,
    received,
    urls,
    sockets,
  };
}

function fakeRun(port: number) {
  const calls: string[][] = [];
  const browser = { viewport: "1280x720@1" };
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "stream")
      return JSON.stringify({ success: true, data: { port } });
    if (args[0] === "set" && args[1] === "viewport")
      browser.viewport = `${args[2]}x${args[3]}@${args[4]}`;
    if (args[0] === "eval") return JSON.stringify(browser.viewport);
    return "";
  };
  return { calls, run, browser };
}

const stubVideo: BrowserVideo = {
  available: () => true,
  calibrate: async () => 56,
  start: () => ({ stop: () => {} }),
};

function fakeVideo() {
  const starts: { width: number; height: number; top: number }[] = [];
  const stops: number[] = [];
  let emit: ((frame: Buffer, key: boolean) => void) | null = null;
  const video: BrowserVideo = {
    available: () => true,
    calibrate: async () => 56,
    start: (opts) => {
      const n = starts.push({
        width: opts.width,
        height: opts.height,
        top: opts.top,
      });
      emit = opts.onFrame;
      return { stop: () => stops.push(n) };
    },
  };
  return {
    video,
    starts,
    stops,
    emit: (f: Buffer, k: boolean) => emit?.(f, k),
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
    return { ws, messages };
  };
}

async function until(check: () => boolean, ms = 2_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const closed = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((r) =>
    ws.once("close", (code, reason) => r({ code, reason: reason.toString() })),
  );

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
  // TEST_SCENARIO: A panel opens on an address. The session is opened there, the panel's frame-rate setting reaches the stream server, frames flow to the panel as binary messages and the panel's input flows to the browser.
  it("opens the address, drops screencast frames and pipes input", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const connect = await host(
      createBrowserPreview({
        run,
        profileDir: "/tmp/x",
        video: stubVideo,
        log: () => {},
      }),
    );

    const { ws, messages } = await connect(
      "url=http%3A%2F%2F127.0.0.1%3A5173%2F&token=secret",
    );
    await until(() => stream.received.length > 0);

    expect(calls[0]).toEqual(["open", "http://127.0.0.1:5173/"]);
    expect(stream.urls[0]).toBe("/");
    expect(JSON.parse(stream.received[0]!)).toEqual({
      type: "screencast_stop",
    });

    ws.send(JSON.stringify({ type: "input_mouse", eventType: "mousePressed" }));
    await until(() => stream.received.length > 1);
    expect(JSON.parse(stream.received[1]!)).toMatchObject({
      type: "input_mouse",
    });
    expect(
      messages.some((m) => typeof m === "string" && m.includes('"frame"')),
    ).toBe(false);
    expect(messages.some((m) => Buffer.isBuffer(m))).toBe(false);
  });

  // TEST_SCENARIO: an agent whose image lacks the virtual display or ffmpeg cannot stream; the panel is told so in words and the connection closes, rather than showing a blank panel.
  it("refuses a panel when the image cannot stream video", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const connect = await host(
      createBrowserPreview({
        run,
        profileDir: "/tmp/x",
        video: { ...stubVideo, available: () => false },
        log: () => {},
      }),
    );
    const { ws, messages } = await connect("");
    const done = closed(ws);
    expect((await done).code).toBe(1011);
    expect(JSON.parse(messages[0] as string)).toEqual({
      type: "preview_error",
      message: VIDEO_UNAVAILABLE,
    });
    expect(calls).toEqual([]);
  });

  // TEST_SCENARIO: A panel that reconnects without an address must not reload the page the user was on: the session is only asked for its stream, never navigated.
  it("reattaches without navigating when no address is given", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const connect = await host(
      createBrowserPreview({
        run,
        profileDir: "/tmp/x",
        video: stubVideo,
        log: () => {},
      }),
    );

    await connect("");
    await until(() => stream.received.length > 0);
    expect(calls).toEqual([["stream", "status", "--json"]]);
  });

  // TEST_SCENARIO: The address bar sends navigate, reload, back and forward, and the panel sends its size as resize, all as control messages. The viewport is set at the panel's pixel ratio, so the video is sharp on a high-density screen; platform-browser scales the agent's screenshots back to CSS pixels. The runtime runs them as agent-browser commands and does not pass them on to the stream server; a non-web address is answered with an error message rather than opened. Navigation runs in the page rather than through `open`, which holds agent-browser's one-at-a-time command queue until the page has loaded — a slow page held every resize behind it for up to 20 seconds.
  it("handles control messages itself", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const connect = await host(
      createBrowserPreview({
        run,
        profileDir: "/tmp/x",
        video: stubVideo,
        log: () => {},
      }),
    );
    const { ws, messages } = await connect("");
    await until(() => stream.received.length > 0);

    ws.send(JSON.stringify({ type: "navigate", url: "https://example.com" }));
    ws.send(JSON.stringify({ type: "reload" }));
    ws.send(JSON.stringify({ type: "back" }));
    ws.send(JSON.stringify({ type: "forward" }));
    ws.send(
      JSON.stringify({ type: "resize", width: 900, height: 640, scale: 2 }),
    );
    ws.send(JSON.stringify({ type: "navigate", url: "file:///etc/passwd" }));
    await until(
      () =>
        calls.length >= 6 &&
        messages.some(
          (m) => typeof m === "string" && m.includes("preview_error"),
        ),
    );

    expect(calls).toContainEqual([
      "eval",
      'location.href = "https://example.com/"',
    ]);
    expect(calls).toContainEqual(["eval", "location.reload()"]);
    expect(calls).toContainEqual(["eval", "history.back()"]);
    expect(calls).toContainEqual(["eval", "history.forward()"]);
    expect(calls.some((c) => c[0] === "open")).toBe(false);
    expect(calls).toContainEqual(["set", "viewport", "900", "640", "2"]);
    expect(calls.flat()).not.toContain("file:///etc/passwd");
    expect(
      messages
        .filter((m): m is string => typeof m === "string")
        .map((m) => JSON.parse(m) as { type: string })
        .some((m) => m.type === "preview_error"),
    ).toBe(true);
    expect(stream.received).toEqual([
      JSON.stringify({ type: "screencast_stop" }),
    ]);
  });

  // TEST_SCENARIO: An address given on connect that is not http or https is refused before any browser command runs.
  it("refuses a non-web address on connect", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const connect = await host(
      createBrowserPreview({
        run,
        profileDir: "/tmp/x",
        video: stubVideo,
        log: () => {},
      }),
    );
    const { ws } = await connect("url=file%3A%2F%2F%2Fetc%2Fpasswd");
    expect((await closed(ws)).code).toBe(1008);
    expect(calls).toEqual([]);
  });

  // TEST_SCENARIO: A Chromium costs the agent memory, so the browser is closed once nobody has watched it for the idle window; a viewer who comes back inside the window keeps it open.
  it("closes the browser after the last viewer leaves", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const preview = createBrowserPreview({
      run,
      profileDir: "/tmp/x",
      video: stubVideo,
      idleCloseMs: 80,
      log: () => {},
    });
    const connect = await host(preview);

    const first = await connect("");
    await until(() => stream.received.length > 0);
    first.ws.close();
    await until(() => preview.viewers() === 0);
    const second = await connect("");
    await new Promise((r) => setTimeout(r, 150));
    expect(calls).not.toContainEqual(["close"]);

    second.ws.close();
    await until(() => calls.some((c) => c[0] === "close"));
  });
});

describe("browserCommandLine", () => {
  // TEST_SCENARIO: the panel and the agent must launch the same browser — headed on the virtual display when the image can — so every command the runtime runs goes through platform-browser, the one launcher. Only close goes to agent-browser directly, since platform-browser refuses it on the agent's behalf.
  it("runs commands through platform-browser and close through agent-browser", () => {
    expect(browserCommandLine(["open", "http://a/"], "/p")).toEqual([
      "platform-browser",
      ["open", "http://a/"],
    ]);
    expect(browserCommandLine(["close"], "/p")).toEqual([
      "agent-browser",
      ["--session", "preview", "--profile", "/p", "close"],
    ]);
  });
});

describe("browser preview video", () => {
  // TEST_SCENARIO: a panel that asks for h264 gets video instead of the JPEG screencast. The runtime stops agent-browser's screencast (whose socket still carries input and address updates), drops any JPEG frame that still arrives, starts the encoder at the panel's size below the measured top offset, and restarts it — with a fresh keyframe — whenever the panel resizes.
  it("streams video sized to the panel and restarts it on resize", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const fake = fakeVideo();
    const connect = await host(
      createBrowserPreview({
        run,
        profileDir: "/tmp/x",
        video: fake.video,
        log: () => {},
      }),
    );
    const { ws, messages } = await connect("");
    await until(() => stream.received.length > 0);
    expect(JSON.parse(stream.received[0]!)).toEqual({
      type: "screencast_stop",
    });

    ws.send(JSON.stringify({ type: "resize", width: 900, height: 700 }));
    await until(() => fake.starts.length === 1);
    expect(fake.starts[0]).toEqual({ width: 900, height: 700, top: 56 });
    expect(calls).toContainEqual(["set", "viewport", "900", "700", "1"]);

    fake.emit(Buffer.from("video-1"), true);
    await until(() =>
      messages.some((m) => Buffer.isBuffer(m) && m.toString() === "video-1"),
    );
    expect(
      messages.some((m) => Buffer.isBuffer(m) && m.toString() !== "video-1"),
    ).toBe(false);

    ws.send(JSON.stringify({ type: "resize", width: 600, height: 500 }));
    await until(() => fake.starts.length === 2);
    expect(fake.stops).toContain(1);
    expect(fake.starts[1]).toEqual({ width: 600, height: 500, top: 56 });

    ws.close();
    await until(() => fake.stops.includes(2));
  });
});

describe("resizing", () => {
  // TEST_SCENARIO: dragging the panel's edge sends a size each time it settles, and agent-browser runs one command at a time. Run side by side, the sizes queued behind each other, each restarting the encoder, and the panel took seconds to catch up. While a size is being set, newer ones replace each other, and only the newest is set next, with one encoder restart.
  it("sets only the newest size while one is in flight", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    let release: () => void = () => {};
    const slowRun = async (args: string[]) => {
      if (args[0] === "set" && calls.every((c) => c[0] !== "set"))
        await new Promise<void>((r) => (release = r));
      return run(args);
    };
    const fake = fakeVideo();
    const connect = await host(
      createBrowserPreview({
        run: slowRun,
        profileDir: "/tmp/x",
        video: fake.video,
        log: () => {},
      }),
    );
    const { ws } = await connect("");
    await until(() => stream.received.length > 0);

    ws.send(JSON.stringify({ type: "resize", width: 900, height: 700 }));
    await new Promise((r) => setTimeout(r, 50));
    for (const width of [800, 700, 600])
      ws.send(JSON.stringify({ type: "resize", width, height: 500 }));
    await new Promise((r) => setTimeout(r, 50));
    release();

    await until(() => fake.starts.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === "set")).toEqual([
      ["set", "viewport", "900", "700", "1"],
      ["set", "viewport", "600", "500", "1"],
    ]);
    expect(fake.starts).toEqual([{ width: 600, height: 500, top: 56 }]);
  });

  // TEST_SCENARIO: a size that fails to apply — the browser busy past the command's deadline — is not the user's error to read: the panel stayed on "set timed out" long after. It is logged, and the viewport check puts the size right once the browser answers.
  it("logs a size that failed instead of telling the panel", async () => {
    const stream = await fakeStream();
    const { calls, run, browser } = fakeRun(stream.port);
    let failing = true;
    const flakyRun = async (args: string[]) => {
      if (failing && args[0] === "set") {
        calls.push(args);
        throw new Error("set timed out");
      }
      return run(args);
    };
    const fake = fakeVideo();
    const logs: string[] = [];
    const connect = await host(
      createBrowserPreview({
        run: flakyRun,
        profileDir: "/tmp/x",
        video: fake.video,
        viewportCheckMs: 50,
        log: (m) => logs.push(m),
      }),
    );
    const { ws, messages } = await connect("");
    await until(() => stream.received.length > 0);

    ws.send(JSON.stringify({ type: "resize", width: 900, height: 700 }));
    await until(() => logs.some((l) => l.includes("set timed out")));
    failing = false;
    await until(() => fake.starts.length === 1);
    expect(browser.viewport).toBe("900x700@1");
    expect(
      messages.some(
        (m) => typeof m === "string" && m.includes("preview_error"),
      ),
    ).toBe(false);
  });
});

describe("viewport check", () => {
  it("reads agent-browser's eval output", () => {
    expect(parseViewport('"570x774@2"')).toEqual({
      width: 570,
      height: 774,
      scale: 2,
    });
    expect(parseViewport("")).toBeNull();
  });

  // TEST_SCENARIO: the agent launched the browser after the panel had sent its size, so the new browser came up at agent-browser's default 1280x720 and the encoder captured only part of the page. The runtime reads the browser's real viewport while video runs, puts the panel's size back, and restarts the encoder at it.
  it("restores the panel's size when the browser comes back at another one", async () => {
    const stream = await fakeStream();
    const { calls, run, browser } = fakeRun(stream.port);
    const starts: number[] = [];
    const video: BrowserVideo = {
      available: () => true,
      calibrate: async () => 56,
      start: (opts) => {
        starts.push(opts.width);
        return { stop: () => {} };
      },
    };
    const connect = await host(
      createBrowserPreview({
        run,
        profileDir: "/tmp/x",
        video,
        viewportCheckMs: 50,
        log: () => {},
      }),
    );
    const { ws } = await connect("");
    ws.send(JSON.stringify({ type: "resize", width: 900, height: 700 }));
    await until(() => starts.length === 1);

    browser.viewport = "1280x720@1";
    const before = calls.filter((c) => c[0] === "set").length;
    await until(() => starts.length === 2);
    expect(browser.viewport).toBe("900x700@1");
    expect(calls.filter((c) => c[0] === "set").length).toBeGreaterThan(before);
  });
});

describe("stopping a stuck browser", () => {
  // TEST_SCENARIO: a page that stops answering leaves every browser command hanging. Commands get a short deadline — longer for open, which loads a page — so none can hang the panel for a minute.
  it("gives commands a short deadline, open a longer one", () => {
    expect(commandTimeoutMs(["open", "http://a/"])).toBe(45_000);
    expect(commandTimeoutMs(["set", "viewport", "1", "1", "1"])).toBe(15_000);
  });

  // TEST_SCENARIO: restarting the panel's browser kills only what belongs to it — the Chromium on the panel's profile and agent-browser processes for the preview session — never the agent's own browser sessions or anything else.
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

  // TEST_SCENARIO: the panel's Restart browser stops the shared browser and drops every viewer with the reconnect code, so each reconnects and launches a fresh browser on the same profile — sign-ins kept.
  it("restarts the browser and reconnects viewers", async () => {
    const stream = await fakeStream();
    const { run } = fakeRun(stream.port);
    let stops = 0;
    const connect = await host(
      createBrowserPreview({
        run,
        profileDir: "/tmp/x",
        video: stubVideo,
        stopBrowser: async () => {
          stops++;
        },
        log: () => {},
      }),
    );
    const { ws } = await connect("");
    await until(() => stream.received.length > 0);
    const done = closed(ws);
    ws.send(JSON.stringify({ type: "restart_browser" }));
    expect((await done).code).toBe(1012);
    expect(stops).toBe(1);
  });

  // TEST_SCENARIO: with the browser stuck, a viewport check never returns; the next checks must wait for it rather than pile up — piled-up commands are what starved the sandbox.
  it("runs one viewport check at a time", async () => {
    const stream = await fakeStream();
    const { run: baseRun } = fakeRun(stream.port);
    let evals = 0;
    const run = async (args: string[]) => {
      if (args[0] === "eval") {
        evals++;
        return new Promise<string>(() => {});
      }
      return baseRun(args);
    };
    const video: BrowserVideo = {
      available: () => true,
      calibrate: async () => 56,
      start: () => ({ stop: () => {} }),
    };
    const connect = await host(
      createBrowserPreview({
        run,
        profileDir: "/tmp/x",
        video,
        viewportCheckMs: 20,
        log: () => {},
      }),
    );
    const { ws } = await connect("");
    ws.send(JSON.stringify({ type: "resize", width: 900, height: 700 }));
    await new Promise((r) => setTimeout(r, 300));
    expect(evals).toBe(1);
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
