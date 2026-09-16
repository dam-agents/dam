import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_PROMPT_MAX_LENGTH,
  ARTIFACT_PROMPT_TYPE,
} from "api-server-api";

import { ARTIFACT_BRIDGE_SHIM_BODY } from "../../modules/artifact-library/viewer/bridge-shim.js";
import { renderHtmlInner } from "../../modules/artifact-library/viewer/renderer.js";

function page() {
  const postMessage = vi.fn();
  const window = {
    parent: { postMessage },
    platform: { sendPrompt: (_prompt: unknown): void => {} },
  };
  runInNewContext(ARTIFACT_BRIDGE_SHIM_BODY, { window });
  return { platform: window.platform, postMessage };
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

  it("does not advertise the removed request/answer API", () => {
    expect(Object.keys(page().platform)).toEqual(["sendPrompt"]);
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
      "window.platform = Object.freeze(",
    );
  });
});
