import { describe, expect, test, vi } from "vitest";

import { ARTIFACT_BRIDGE_SHIM } from "../../modules/artifact-library/viewer/bridge-shim.js";
import {
  renderHtmlInner,
  renderTextKindInner,
} from "../../modules/artifact-library/viewer/renderer.js";

// TEST_OVERVIEW: The shim is the whole public API of an interactive page: `platform.ask` for one Artifact Request, `platform.onState` for what the app is doing with it, `platform.ready` for the moment the port arrived. It is injected only into an interactive page, and only ahead of that page's own scripts, so a page can ask on load. Everything under it — the `artifact.connect` handshake, the MessagePort, the `ref` that ties a reply to the ask waiting for it — is the shim's business and never the page's. A page that is not interactive must come out of the renderer exactly as it went in.

const SHIM_BODY = ARTIFACT_BRIDGE_SHIM.replace(/^<script>/, "").replace(
  /<\/script>$/,
  "",
);

interface PageRequest {
  type: string;
  ref: string;
  action: string;
  payload?: Record<string, unknown>;
}

interface Platform {
  ask: (action: unknown, payload?: unknown) => Promise<unknown>;
  onState: (watcher: (state: string) => void) => () => void;
  ready: Promise<void>;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadPage() {
  const listeners: ((event: unknown) => void)[] = [];
  const posted: PageRequest[] = [];
  const parent = {
    postMessage: (data: PageRequest) => posted.push(data),
  };
  const pageWindow: Record<string, unknown> = {
    parent,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "message") listeners.push(listener);
    },
  };
  new Function("window", SHIM_BODY)(pageWindow);

  return {
    posted,
    get platform(): Platform {
      return pageWindow.platform as Platform;
    },
    connect(port: MessagePort) {
      for (const listener of listeners)
        listener({
          source: parent,
          data: { type: "artifact.connect" },
          ports: [port],
        });
    },
    connectFrom(source: unknown, port: MessagePort) {
      for (const listener of listeners)
        listener({ source, data: { type: "artifact.connect" }, ports: [port] });
    },
  };
}

function connectedPage() {
  const page = loadPage();
  const channel = new MessageChannel();
  page.connect(channel.port2 as unknown as MessagePort);
  return {
    ...page,
    get platform() {
      return page.platform;
    },
    app: channel.port1,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

describe("what the shim puts on the page", () => {
  test("offers ask, onState and ready, and nothing else", () => {
    const page = loadPage();
    expect(Object.keys(page.platform).sort()).toEqual([
      "ask",
      "onState",
      "ready",
    ]);
  });

  test("carries the answer back to the ask that is waiting for it", async () => {
    const page = connectedPage();
    const answer = page.platform.ask("refresh", { since: "yesterday" });
    await flush();

    expect(page.posted).toHaveLength(1);
    const sent = page.posted[0]!;
    expect(sent).toMatchObject({
      type: "artifact.request",
      action: "refresh",
      payload: { since: "yesterday" },
    });
    expect(sent.ref).toMatch(/^\d+\./);

    page.app.postMessage({
      type: "artifact.answer",
      ref: sent.ref,
      result: { now: "12:00" },
    });
    await expect(answer).resolves.toEqual({ now: "12:00" });
    page.close();
  });

  // TEST_SCENARIO: A refusal is the app's or the server's, and the page has its own wording for each named reason. The rejection has to carry the reason, not only prose.
  test("rejects with the named reason and its message", async () => {
    const page = connectedPage();
    const answer = page.platform.ask("refresh");
    await flush();

    page.app.postMessage({
      type: "artifact.failed",
      ref: page.posted[0]!.ref,
      reason: "busy",
      message: "This page is already waiting on an answer.",
    });

    await expect(answer).rejects.toMatchObject({
      reason: "busy",
      message: "This page is already waiting on an answer.",
    });
    page.close();
  });

  test("reports every state the app sends to onState watchers", async () => {
    const page = connectedPage();
    const seen: string[] = [];
    const stop = page.platform.onState((state) => seen.push(state));
    const answer = page.platform.ask("refresh");
    await flush();

    const { ref } = page.posted[0]!;
    for (const state of ["sent", "waking", "running"])
      page.app.postMessage({ type: "artifact.state", ref, state });
    await flush();
    expect(seen).toEqual(["sent", "waking", "running"]);

    stop();
    page.app.postMessage({ type: "artifact.state", ref, state: "queued" });
    await flush();
    expect(seen).toEqual(["sent", "waking", "running"]);

    page.app.postMessage({ type: "artifact.answer", ref, result: null });
    await answer;
    page.close();
  });

  // TEST_SCENARIO: A page that asks as soon as it loads is the normal case — the app only hands over the port once the frame has loaded, which is after the page's own scripts have run.
  test("holds an ask made before the port arrives", async () => {
    const page = loadPage();
    const answer = page.platform.ask("refresh");
    await flush();
    expect(page.posted).toHaveLength(0);

    const channel = new MessageChannel();
    page.connect(channel.port2 as unknown as MessagePort);
    await flush();
    expect(page.posted).toHaveLength(1);

    channel.port1.postMessage({
      type: "artifact.answer",
      ref: page.posted[0]!.ref,
      result: "late",
    });
    await expect(answer).resolves.toBe("late");
    channel.port1.close();
    channel.port2.close();
  });

  test("resolves ready once the app has handed over the port", async () => {
    const page = loadPage();
    let arrived = false;
    void page.platform.ready.then(() => {
      arrived = true;
    });
    await flush();
    expect(arrived).toBe(false);

    const channel = new MessageChannel();
    page.connect(channel.port2 as unknown as MessagePort);
    await flush();
    expect(arrived).toBe(true);
    channel.port1.close();
    channel.port2.close();
  });

  // TEST_SCENARIO: The app drops a request whose shape it does not recognise, so a page that asks with a bad payload would otherwise wait forever. Say so to the page instead.
  test("refuses an ask with no action or a payload that is not an object", async () => {
    const page = connectedPage();
    await expect(page.platform.ask("")).rejects.toThrow(/action name/);
    await expect(page.platform.ask("refresh", 42)).rejects.toThrow(
      /plain object/,
    );
    await expect(page.platform.ask("refresh", ["a"])).rejects.toThrow(
      /plain object/,
    );
    expect(page.posted).toHaveLength(0);
    page.close();
  });

  // TEST_SCENARIO: Only the app is above the frame. A frame the page itself embeds must not be able to hand it a port and answer in the app's place.
  test("ignores a connect that did not come from the app", async () => {
    const page = loadPage();
    const channel = new MessageChannel();
    page.connectFrom(
      { postMessage: () => undefined },
      channel.port2 as unknown as MessagePort,
    );
    const answer = page.platform.ask("refresh");
    await flush();
    expect(page.posted).toHaveLength(0);
    void answer.catch(() => undefined);
    channel.port1.close();
    channel.port2.close();
  });

  // TEST_SCENARIO: The app closes the port when the preview goes away, and the page has no way to see that. Without a bound wait, a page whose app-side bridge is not there — the feature flag turned off after the page was published — would spin forever.
  test("gives up on an ask when no port ever arrives", async () => {
    vi.useFakeTimers();
    try {
      const page = loadPage();
      const answer = page.platform.ask("refresh");
      const rejected = expect(answer).rejects.toMatchObject({
        reason: "wake_failed",
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: The app hands over a fresh port whenever it rebuilds the bridge. An ask tied to the port that is gone can never be answered, so it must not be left hanging.
  test("drops asks still outstanding when a second port arrives", async () => {
    const page = loadPage();
    const first = new MessageChannel();
    page.connect(first.port2 as unknown as MessagePort);
    const answer = page.platform.ask("refresh");
    await flush();

    const second = new MessageChannel();
    page.connect(second.port2 as unknown as MessagePort);
    await expect(answer).rejects.toMatchObject({ reason: "cancelled" });

    first.port1.close();
    second.port1.close();
    second.port2.close();
  });
});

describe("which pages get the shim", () => {
  const page = `<!doctype html><html><head><title>t</title></head><body><script>go()</script></body></html>`;

  test("injects it ahead of the page's own scripts", () => {
    const rendered = renderHtmlInner(page, true);
    expect(rendered).toContain("window.platform");
    expect(rendered.indexOf("window.platform")).toBeLessThan(
      rendered.indexOf("go()"),
    );
  });

  // TEST_SCENARIO: An artifact that cannot ask its agent must render exactly as it did before the shim existed — the share viewer serves those bytes to anyone with the link.
  test("leaves a page that is not interactive byte-identical", () => {
    expect(renderHtmlInner(page)).toBe(
      `<!doctype html><html><head><base target="_blank"><title>t</title></head><body><script>go()</script></body></html>`,
    );
    expect(renderHtmlInner(page, false)).toBe(renderHtmlInner(page));
    expect(
      renderTextKindInner("html", page, { title: "t", fileName: "a.html" }),
    ).toBe(renderHtmlInner(page));
  });

  test("still injects it into a page that sets its own base target", () => {
    const withBase = `<!doctype html><html><head><base target="_self"></head><body></body></html>`;
    expect(renderHtmlInner(withBase)).toBe(withBase);
    const rendered = renderHtmlInner(withBase, true);
    expect(rendered).toContain("window.platform");
    expect(rendered).not.toContain(`<base target="_blank">`);
  });

  test("puts it first when the page has no head", () => {
    const rendered = renderHtmlInner("<p>bare</p>", true);
    expect(rendered.indexOf("window.platform")).toBeLessThan(
      rendered.indexOf("<p>bare</p>"),
    );
    expect(rendered).toContain(`<base target="_blank">`);
  });
});
