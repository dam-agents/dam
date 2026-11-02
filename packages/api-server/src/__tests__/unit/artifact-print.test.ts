// TEST_OVERVIEW: A shared artifact prints in full with the browser's own print. The artifact frame stays sandboxed without modals, so the frame never prints itself. Its document reports its content height to the share page, and on beforeprint the share page stretches the frame to that height, so the browser breaks the frame across pages. On afterprint the frame returns to its normal size.
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { ARTIFACT_PRINT_MAX_WIDTH, ARTIFACT_SIZE_TYPE } from "api-server-api";

import {
  ARTIFACT_SIZE_REPORTER,
  ARTIFACT_SIZE_REPORTER_BODY,
  FRAME_PRINT_BODY,
} from "../../modules/artifact-library/viewer/print-size.js";
import {
  renderTextKindInner,
  renderWrapper,
} from "../../modules/artifact-library/viewer/renderer.js";

type Listener = (event: { source?: unknown; data?: unknown }) => void;

function events() {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    fire: (type: string, event: { source?: unknown; data?: unknown } = {}) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function sharePage(frameWidth: number) {
  const page = {};
  const frame = {
    contentWindow: page,
    style: {} as Record<string, string>,
    getBoundingClientRect: () => ({ width: frameWidth }),
    removeAttribute: vi.fn((name: string) => {
      if (name === "style") frame.style = {};
    }),
  };
  const window = events();
  runInNewContext(FRAME_PRINT_BODY, {
    window,
    document: { querySelector: () => frame },
  });
  return { window, frame, page };
}

describe("the share page prints the whole artifact", () => {
  // TEST_SCENARIO: The artifact is taller than the window. On beforeprint the frame must take the height the artifact reported, so nothing below the fold is cut off; afterprint must put the frame back.
  it("stretches the frame to the reported height while printing", () => {
    const { window, frame, page } = sharePage(800);
    window.fire("message", {
      source: page,
      data: { type: ARTIFACT_SIZE_TYPE, height: 9000 },
    });

    window.fire("beforeprint");
    expect(frame.style).toMatchObject({
      flex: "none",
      width: "800px",
      height: "9000px",
      transform: "scale(1)",
    });

    window.fire("afterprint");
    expect(frame.removeAttribute).toHaveBeenCalledWith("style");
    expect(frame.style).toEqual({});
  });

  // TEST_SCENARIO: On a wide window the artifact is laid out wider than a sheet of paper, and the browser would clip its right side. The frame keeps its layout width and is scaled down to the print width, with its margins pulled in so the scaled box takes only its scaled space.
  it("scales a wide frame down to the print width", () => {
    const width = ARTIFACT_PRINT_MAX_WIDTH * 2;
    const { window, frame, page } = sharePage(width);
    window.fire("message", {
      source: page,
      data: { type: ARTIFACT_SIZE_TYPE, height: 4000 },
    });

    window.fire("beforeprint");
    expect(frame.style).toMatchObject({
      width: `${width}px`,
      height: "4000px",
      transform: "scale(0.5)",
      transformOrigin: "0 0",
      marginRight: `${-0.5 * width}px`,
      marginBottom: "-2000px",
    });
  });

  // TEST_SCENARIO: Any window can post to the share page. Only the artifact frame's own document may set the print height, and only with a sane positive number.
  it.each([
    ["another window", { source: {}, height: 9000 }],
    ["a zero height", { height: 0 }],
    ["a text height", { height: "9000" }],
    ["an absurd height", { height: 10_000_000 }],
  ])("ignores a size from %s", (_name, { source, height }) => {
    const { window, frame, page } = sharePage(800);
    window.fire("message", {
      source: source ?? page,
      data: { type: ARTIFACT_SIZE_TYPE, height },
    });
    window.fire("beforeprint");
    expect(frame.style).toEqual({});
  });

  // TEST_SCENARIO: The page prints without its banner and status chrome, and the full-height flex layout is released so the stretched frame can run onto later pages.
  it("hides the banner and releases the full-height layout in print", () => {
    const html = renderWrapper({
      title: "Report",
      brandName: "DAM",
      contentUrl: "https://content.example.com/a/s?v=1&t=x",
      slug: "s",
      version: 1,
      downloadName: "report.md",
    });
    const print = /@media print \{([\s\S]*?)\n {2}\}/.exec(html)?.[1] ?? "";
    expect(print).toContain(".banner, .relay-status { display: none; }");
    expect(print).toContain("html, body { height: auto; }");
    expect(html).toContain(FRAME_PRINT_BODY);
  });
});

describe("the artifact reports its content height", () => {
  function artifactDocument(scrollHeight: number) {
    const postMessage = vi.fn();
    const observed: unknown[] = [];
    let resize = () => {};
    const window = { ...events(), parent: { postMessage } };
    const document = {
      ...events(),
      documentElement: { scrollHeight },
      body: { scrollHeight },
    };
    runInNewContext(ARTIFACT_SIZE_REPORTER_BODY, {
      window,
      document,
      ResizeObserver: class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe(target: unknown) {
          observed.push(target);
        }
      },
    });
    return { window, document, postMessage, observed, resize: () => resize() };
  }

  // TEST_SCENARIO: The document reports its height once it is parsed, again when its content grows, and not again while the height stays the same.
  it("posts the height to the parent on load and on every change", () => {
    const page = artifactDocument(5000);
    page.document.fire("DOMContentLoaded");
    expect(page.observed).toEqual([
      page.document.documentElement,
      page.document.body,
    ]);
    expect(page.postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: ARTIFACT_SIZE_TYPE, height: 5000 },
      "*",
    );

    page.window.fire("load");
    expect(page.postMessage).toHaveBeenCalledTimes(1);

    page.document.body.scrollHeight = 7000;
    page.resize();
    expect(page.postMessage).toHaveBeenLastCalledWith(
      { type: ARTIFACT_SIZE_TYPE, height: 7000 },
      "*",
    );
  });

  // TEST_SCENARIO: Every kind the frame renders from text carries the reporter, so each of them prints in full.
  it.each(["html", "jsx", "markdown", "code"] as const)(
    "is in every %s document",
    (kind) => {
      const html = renderTextKindInner(kind, "# Report", {
        title: "Report",
        fileName: "report.txt",
      });
      expect(html).toContain(ARTIFACT_SIZE_REPORTER);
    },
  );
});
