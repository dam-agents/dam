import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_PROMPT_MAX_LENGTH,
  ARTIFACT_PROMPT_TYPE,
  ARTIFACT_REQUEST_TYPE,
  ARTIFACT_RESPONSE_TYPE,
} from "api-server-api";

import { ARTIFACT_BRIDGE_SHIM_BODY } from "../../modules/artifact-library/viewer/bridge-shim.js";
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
  runInNewContext(ARTIFACT_BRIDGE_SHIM_BODY, { window });
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
    const rendered = renderHtmlInner(source, true);
    expect(rendered.indexOf("window.platform =")).toBeLessThan(
      rendered.indexOf('platform.sendPrompt("hello")'),
    );
    expect(rendered.match(/<base /g)).toHaveLength(1);
  });

  it("supports HTML fragments", () => {
    expect(renderHtmlInner("<button>Refresh</button>", true)).toContain(
      "window.platform = (() => {",
    );
  });
});
