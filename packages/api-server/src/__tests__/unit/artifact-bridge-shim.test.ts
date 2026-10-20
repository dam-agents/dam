import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_PROMPT_MAX_LENGTH,
  ARTIFACT_PROMPT_TYPE,
  ARTIFACT_REQUEST_TIMEOUT_MS,
  ARTIFACT_REQUEST_TYPE,
  ARTIFACT_RESPONSE_TYPE,
} from "api-server-api";

import {
  ARTIFACT_BRIDGE_SHIM_BODY,
  ARTIFACT_SHARED_BRIDGE_SHIM_BODY,
  SHARED_BRIDGE_REFUSAL,
} from "../../modules/artifact-library/viewer/bridge-shim.js";
import { renderHtmlInner } from "../../modules/artifact-library/viewer/renderer.js";

interface PageApi {
  sendPrompt(prompt: unknown): void;
  request(input?: unknown): Promise<unknown>;
}

function page() {
  const postMessage = vi.fn();
  const listeners: ((event: { source: unknown; data: unknown }) => void)[] = [];
  const parent = { postMessage };
  const window = {
    parent,
    platform: undefined as unknown as PageApi,
    addEventListener: (_type: string, listener: (typeof listeners)[number]) =>
      listeners.push(listener),
  };
  runInNewContext(ARTIFACT_BRIDGE_SHIM_BODY, {
    window,
    setTimeout,
    clearTimeout,
  });
  const deliver = (data: unknown, source: unknown = parent) => {
    for (const listener of listeners) listener({ source, data });
  };
  return { platform: window.platform, postMessage, deliver };
}

function sentRequestId(postMessage: ReturnType<typeof vi.fn>): string {
  const [message] = postMessage.mock.lastCall as [{ id: string }];
  return message.id;
}

describe("artifact prompt buttons", () => {
  it("sends the authored prompt without waiting for an agent answer", () => {
    const { platform, postMessage } = page();
    expect(platform.sendPrompt("Refresh this dashboard.")).toBeUndefined();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: ARTIFACT_PROMPT_TYPE, prompt: "Refresh this dashboard." },
      "*",
    );
  });

  it.each([null, {}, 42, "", "  ", "x".repeat(ARTIFACT_PROMPT_MAX_LENGTH + 1)])(
    "refuses an invalid prompt: %j",
    (prompt) => {
      const { platform, postMessage } = page();
      expect(() => platform.sendPrompt(prompt)).toThrow();
      expect(postMessage).not.toHaveBeenCalled();
    },
  );

  it("exposes only the prompt and request functions", () => {
    expect(Object.keys(page().platform)).toEqual(["sendPrompt", "request"]);
  });
});

describe("artifact API requests", () => {
  it("asks the host and resolves with the server's answer, even a 4xx", async () => {
    const { platform, postMessage, deliver } = page();
    const answer = platform.request({
      method: "POST",
      path: "/notes?draft=1",
      body: '{"text":"hi"}',
    });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: ARTIFACT_REQUEST_TYPE,
        id: expect.any(String),
        method: "POST",
        path: "/notes?draft=1",
        body: '{"text":"hi"}',
        contentType: undefined,
      },
      "*",
    );
    deliver({
      type: ARTIFACT_RESPONSE_TYPE,
      id: sentRequestId(postMessage),
      ok: true,
      status: 404,
      contentType: "text/plain",
      body: "missing",
    });
    await expect(answer).resolves.toEqual({
      status: 404,
      contentType: "text/plain",
      body: "missing",
    });
  });

  it("rejects with the platform reason", async () => {
    const { platform, postMessage, deliver } = page();
    const answer = platform.request({ method: "GET", path: "/" });
    deliver({
      type: ARTIFACT_RESPONSE_TYPE,
      id: sentRequestId(postMessage),
      ok: false,
      reason: "app-not-listening",
    });
    await expect(answer).rejects.toMatchObject({ reason: "app-not-listening" });
  });

  it("ignores answers from other windows and for unknown requests", async () => {
    const { platform, postMessage, deliver } = page();
    const answer = platform.request({ method: "GET", path: "/" });
    const id = sentRequestId(postMessage);
    const ok = { type: ARTIFACT_RESPONSE_TYPE, ok: true, contentType: null };
    deliver({ ...ok, id, status: 500, body: "spoofed" }, {});
    deliver({ ...ok, id: "unknown", status: 500, body: "stray" });
    deliver({ ...ok, id, status: 200, body: "real" });
    deliver({ ...ok, id, status: 500, body: "late duplicate" });
    await expect(answer).resolves.toMatchObject({ status: 200, body: "real" });
  });

  it("rejects with a timeout when the host never answers", async () => {
    vi.useFakeTimers();
    try {
      const { platform, postMessage, deliver } = page();
      const answer = platform.request({ method: "GET", path: "/" });
      const settled = expect(answer).rejects.toMatchObject({
        reason: "timeout",
      });
      vi.advanceTimersByTime(ARTIFACT_REQUEST_TIMEOUT_MS);
      await settled;
      deliver({
        type: ARTIFACT_RESPONSE_TYPE,
        id: sentRequestId(postMessage),
        ok: true,
        status: 200,
        contentType: null,
        body: "too late",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an answered request settled after the timeout passes", async () => {
    vi.useFakeTimers();
    try {
      const { platform, postMessage, deliver } = page();
      const answer = platform.request({ method: "GET", path: "/" });
      deliver({
        type: ARTIFACT_RESPONSE_TYPE,
        id: sentRequestId(postMessage),
        ok: true,
        status: 200,
        contentType: null,
        body: "on time",
      });
      vi.advanceTimersByTime(ARTIFACT_REQUEST_TIMEOUT_MS);
      await expect(answer).resolves.toMatchObject({ body: "on time" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives every request its own id", () => {
    const { platform, postMessage } = page();
    void platform.request({ method: "GET", path: "/a" });
    const first = sentRequestId(postMessage);
    void platform.request({ method: "GET", path: "/a" });
    expect(sentRequestId(postMessage)).not.toBe(first);
  });

  it.each([
    undefined,
    { method: "HEAD", path: "/" },
    { method: "GET", path: "relative" },
    { method: "GET" },
    { method: "POST", path: "/", body: { text: "hi" } },
  ])("refuses an invalid request: %j", (input) => {
    const { platform, postMessage } = page();
    expect(() => platform.request(input)).toThrow();
    expect(postMessage).not.toHaveBeenCalled();
  });
});

function sharedPage() {
  const postMessage = vi.fn();
  const shown: { textContent: string }[] = [];
  const window = {
    parent: { postMessage },
    platform: undefined as unknown as PageApi,
    addEventListener: vi.fn(),
  };
  const document = {
    body: { append: (node: { textContent: string }) => shown.push(node) },
    createElement: () => ({
      setAttribute: vi.fn(),
      style: {},
      textContent: "",
    }),
  };
  runInNewContext(ARTIFACT_SHARED_BRIDGE_SHIM_BODY, {
    window,
    document,
    setTimeout,
    clearTimeout,
  });
  return { platform: window.platform, postMessage, shown };
}

describe("artifact bridge on a shared page", () => {
  /**
   * TEST_SCENARIO: A viewer the owner invited opens a shared interactive page
   * and clicks its buttons. Nothing reaches the host, so the viewer can never
   * make the owner's agent act. The calls fail at once, with no 3-minute
   * wait, and the page shows one notice that says why.
   */
  it("refuses a prompt at once and tells the viewer why", () => {
    const { platform, postMessage, shown } = sharedPage();
    expect(() => platform.sendPrompt("Refresh this dashboard.")).toThrow(
      SHARED_BRIDGE_REFUSAL,
    );
    expect(postMessage).not.toHaveBeenCalled();
    expect(shown.map((node) => node.textContent)).toEqual([
      SHARED_BRIDGE_REFUSAL,
    ]);
  });

  it("rejects a request at once with not-allowed", async () => {
    vi.useFakeTimers();
    try {
      const { platform, postMessage } = sharedPage();
      await expect(
        platform.request({ method: "GET", path: "/state" }),
      ).rejects.toMatchObject({ reason: "not-allowed" });
      expect(vi.getTimerCount()).toBe(0);
      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows its notice only once", async () => {
    const { platform, shown } = sharedPage();
    expect(() => platform.sendPrompt("one")).toThrow();
    await expect(
      platform.request({ method: "GET", path: "/" }),
    ).rejects.toThrow();
    expect(shown).toHaveLength(1);
  });

  it("keeps the same API shape as the owner's page", () => {
    expect(Object.keys(sharedPage().platform)).toEqual([
      "sendPrompt",
      "request",
    ]);
  });
});

describe("artifact preview rendering", () => {
  it("leaves ordinary HTML rendering unchanged", () => {
    const source = "<html><head></head><body>Report</body></html>";
    expect(renderHtmlInner(source)).toBe(
      '<html><head><base target="_blank"></head><body>Report</body></html>',
    );
    const withBase = '<head><base target="_self"></head><p>Report</p>';
    expect(renderHtmlInner(withBase)).toBe(withBase);
  });

  it("installs the API before authored scripts even with an existing base", () => {
    const source =
      '<head><base target="_self"><script>platform.sendPrompt("hello")</script></head>';
    const rendered = renderHtmlInner(source, "owner");
    expect(rendered.indexOf("window.platform =")).toBeLessThan(
      rendered.indexOf('platform.sendPrompt("hello")'),
    );
    expect(rendered.match(/<base /g)).toHaveLength(1);
  });

  it("gives a shared page the refusing API, never the owner's", () => {
    const rendered = renderHtmlInner("<button>Refresh</button>", "shared");
    expect(rendered).toContain(SHARED_BRIDGE_REFUSAL);
    expect(rendered).not.toContain(ARTIFACT_REQUEST_TYPE);
    expect(rendered).not.toContain(ARTIFACT_PROMPT_TYPE);
  });

  it("supports HTML fragments", () => {
    expect(renderHtmlInner("<button>Refresh</button>", "owner")).toContain(
      "window.platform = (() => {",
    );
  });
});
