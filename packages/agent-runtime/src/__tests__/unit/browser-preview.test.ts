import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
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
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "stream")
      return JSON.stringify({ success: true, data: { port } });
    return "";
  };
  return { calls, run };
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
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(d.toString()));
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
  it("recognises navigate, reload, clear_data and a bounded resize only", () => {
    expect(parseControl('{"type":"navigate","url":"http://a"}')).toEqual({
      type: "navigate",
      url: "http://a",
    });
    expect(parseControl('{"type":"reload"}')).toEqual({ type: "reload" });
    expect(parseControl('{"type":"clear_data"}')).toEqual({
      type: "clear_data",
    });
    expect(
      parseControl('{"type":"resize","width":900,"height":640}'),
    ).toEqual({ type: "resize", width: 900, height: 640 });
    expect(parseControl('{"type":"resize","width":10,"height":640}')).toBeNull();
    expect(
      parseControl('{"type":"resize","width":900.5,"height":640}'),
    ).toBeNull();
    expect(parseControl('{"type":"input_mouse"}')).toBeNull();
    expect(parseControl('{"type":"navigate"}')).toBeNull();
    expect(parseControl("{")).toBeNull();
  });
});

describe("browser preview", () => {
  // TEST_SCENARIO: A panel opens on an address. The session is opened there, the panel's frame-rate setting reaches the stream server, frames flow to the panel and the panel's input flows to the browser.
  it("opens the address and pipes frames and input", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const connect = await host(
      createBrowserPreview({ run, profileDir: "/tmp/x", log: () => {} }),
    );

    const { ws, messages } = await connect(
      "url=http%3A%2F%2F127.0.0.1%3A5173%2F&maxFps=10&token=secret",
    );
    await until(() => messages.length > 0);

    expect(calls[0]).toEqual(["open", "http://127.0.0.1:5173/"]);
    expect(JSON.parse(messages[0]!)).toMatchObject({ type: "frame", seq: 1 });
    expect(stream.urls[0]).toBe("/?maxFps=10");

    ws.send(JSON.stringify({ type: "input_mouse", eventType: "mousePressed" }));
    await until(() => stream.received.length > 0);
    expect(JSON.parse(stream.received[0]!)).toMatchObject({
      type: "input_mouse",
    });
  });

  // TEST_SCENARIO: A panel that reconnects without an address must not reload the page the user was on: the session is only asked for its stream, never navigated.
  it("reattaches without navigating when no address is given", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const connect = await host(
      createBrowserPreview({ run, profileDir: "/tmp/x", log: () => {} }),
    );

    const { messages } = await connect("");
    await until(() => messages.length > 0);
    expect(calls).toEqual([["stream", "status", "--json"]]);
  });

  // TEST_SCENARIO: The address bar sends navigate and reload, and the panel sends its size as resize, all as control messages. The runtime runs them as agent-browser commands and does not pass them on to the stream server; a non-web address is answered with an error message rather than opened.
  it("handles control messages itself", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const connect = await host(
      createBrowserPreview({ run, profileDir: "/tmp/x", log: () => {} }),
    );
    const { ws, messages } = await connect("");
    await until(() => messages.length > 0);

    ws.send(JSON.stringify({ type: "navigate", url: "https://example.com" }));
    ws.send(JSON.stringify({ type: "reload" }));
    ws.send(JSON.stringify({ type: "resize", width: 900, height: 640 }));
    ws.send(JSON.stringify({ type: "navigate", url: "file:///etc/passwd" }));
    await until(() => messages.length > 1 && calls.length >= 4);

    expect(calls).toContainEqual(["open", "https://example.com/"]);
    expect(calls).toContainEqual(["reload"]);
    expect(calls).toContainEqual(["set", "viewport", "900", "640"]);
    expect(calls.flat()).not.toContain("file:///etc/passwd");
    expect(JSON.parse(messages.at(-1)!)).toMatchObject({
      type: "preview_error",
    });
    expect(stream.received).toEqual([]);
  });

  // TEST_SCENARIO: An address given on connect that is not http or https is refused before any browser command runs.
  it("refuses a non-web address on connect", async () => {
    const stream = await fakeStream();
    const { calls, run } = fakeRun(stream.port);
    const connect = await host(
      createBrowserPreview({ run, profileDir: "/tmp/x", log: () => {} }),
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
      idleCloseMs: 80,
      log: () => {},
    });
    const connect = await host(preview);

    const first = await connect("");
    await until(() => first.messages.length > 0);
    first.ws.close();
    await until(() => preview.viewers() === 0);
    const second = await connect("");
    await new Promise((r) => setTimeout(r, 150));
    expect(calls).not.toContainEqual(["close"]);

    second.ws.close();
    await until(() => calls.some((c) => c[0] === "close"));
  });
});
