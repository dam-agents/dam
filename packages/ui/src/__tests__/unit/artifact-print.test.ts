// @vitest-environment happy-dom
// TEST_OVERVIEW: The in-app artifact preview prints in full with the browser's own print. The frame's document reports its content height, and on beforeprint the preview stretches the frame to that height and marks it, so the print stylesheet hides the rest of the app. On afterprint the frame returns to its normal size.
import { ARTIFACT_PRINT_MAX_WIDTH, ARTIFACT_SIZE_TYPE } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { DeferredFrame } from "../../modules/artifacts/components/deferred-frame.js";
import { ARTIFACT_PRINT_ATTRIBUTE } from "../../modules/artifacts/lib/artifact-print.js";

vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useCallAgentApi: () => ({ mutateAsync: vi.fn() }),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function preview(frameWidth: number) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(DeferredFrame, {
        html: "<p>Report</p>",
        title: "Report",
        className: "",
        deferMs: 0,
      }),
    ),
  );
  const frame = host.querySelector("iframe")!;
  frame.getBoundingClientRect = () => ({ width: frameWidth }) as DOMRect;
  const reportHeight = (height: unknown, source = frame.contentWindow) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        data: { type: ARTIFACT_SIZE_TYPE, height },
      }),
    );
  return { root, frame, reportHeight };
}

// TEST_SCENARIO: The artifact is taller than the panel. Printing must stretch the frame to the reported height and mark it for the print stylesheet; afterprint must put it back.
it("stretches the frame to the reported height while printing", () => {
  const { root, frame, reportHeight } = preview(600);
  reportHeight(9000);

  window.dispatchEvent(new Event("beforeprint"));
  expect(frame.hasAttribute(ARTIFACT_PRINT_ATTRIBUTE)).toBe(true);
  expect(frame.style.height).toBe("9000px");
  expect(frame.style.width).toBe("600px");

  window.dispatchEvent(new Event("afterprint"));
  expect(frame.hasAttribute(ARTIFACT_PRINT_ATTRIBUTE)).toBe(false);
  expect(frame.getAttribute("style")).toBeNull();
  act(() => root.unmount());
});

// TEST_SCENARIO: In full page on a wide screen the artifact is wider than a sheet of paper. The frame keeps its layout width and is scaled down to the print width, so its right side is not clipped.
it("scales a wide frame down to the print width", () => {
  const width = ARTIFACT_PRINT_MAX_WIDTH * 2;
  const { root, frame, reportHeight } = preview(width);
  reportHeight(4000);

  window.dispatchEvent(new Event("beforeprint"));
  expect(frame.style.transform).toBe("scale(0.5)");
  expect(frame.style.marginBottom).toBe("-2000px");
  act(() => root.unmount());
});

// TEST_SCENARIO: Any window can post to the app. A size from another window, or a malformed one, must leave the frame alone when printing.
it.each([
  ["another window", 9000, {} as Window],
  ["a zero height", 0, undefined],
  ["a text height", "9000", undefined],
])("ignores a size from %s", (_name, height, source) => {
  const { root, frame, reportHeight } = preview(600);
  reportHeight(height, source ?? frame.contentWindow);

  window.dispatchEvent(new Event("beforeprint"));
  expect(frame.hasAttribute(ARTIFACT_PRINT_ATTRIBUTE)).toBe(false);
  expect(frame.style.height).toBe("");
  act(() => root.unmount());
});
