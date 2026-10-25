// @vitest-environment happy-dom
// TEST_OVERVIEW: The user picks elements in the artifact preview and the app leaves a quote of them in the chat composer. The preview frame is untrusted, so the app takes a pick only while pick mode is on and only from that frame, and the quote names the artifact the way its Agent's tools do.
import {
  ARTIFACT_PICK_CANCEL_TYPE,
  ARTIFACT_PICK_MAX_ELEMENTS,
  ARTIFACT_PICK_SNIPPET_MAX_LENGTH,
  ARTIFACT_PICK_START_TYPE,
  ARTIFACT_PICK_STOP_TYPE,
  ARTIFACT_PICK_TYPE,
} from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeferredFrame } from "../../modules/artifacts/components/deferred-frame.js";
import {
  artifactPickQuote,
  readArtifactPick,
} from "../../modules/artifacts/lib/artifact-pick.js";

vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useCallAgentApi: () => ({ mutateAsync: vi.fn() }),
}));

afterEach(() => {
  document.body.replaceChildren();
});

const heading = {
  selector: "h1#title",
  snippet: '<h1 id="title">Revenue</h1>',
};

describe("reading a pick from the frame", () => {
  // TEST_SCENARIO: another window posts a well-formed pick; only the preview frame's own window counts.
  it("accepts only the exact frame", () => {
    const { port1, port2 } = new MessageChannel();
    const data = { type: ARTIFACT_PICK_TYPE, elements: [heading] };
    expect(readArtifactPick({ source: port1, data }, port1)).toEqual(data);
    expect(readArtifactPick({ source: port2, data }, port1)).toBeNull();
    expect(readArtifactPick({ source: port1, data }, null)).toBeNull();
    port1.close();
    port2.close();
  });

  // TEST_SCENARIO: a page that fakes the picker cannot push an empty, oversized or unknown message into the composer.
  it.each([
    {},
    { type: ARTIFACT_PICK_START_TYPE },
    { type: ARTIFACT_PICK_TYPE, elements: [] },
    {
      type: ARTIFACT_PICK_TYPE,
      elements: Array.from(
        { length: ARTIFACT_PICK_MAX_ELEMENTS + 1 },
        () => heading,
      ),
    },
    {
      type: ARTIFACT_PICK_TYPE,
      elements: [
        {
          selector: "p",
          snippet: "x".repeat(ARTIFACT_PICK_SNIPPET_MAX_LENGTH + 1),
        },
      ],
    },
  ])("rejects a malformed or oversized message: %j", (data) => {
    const { port1, port2 } = new MessageChannel();
    expect(readArtifactPick({ source: port1, data }, port1)).toBeNull();
    port1.close();
    port2.close();
  });
});

describe("the quote left in the composer", () => {
  // TEST_SCENARIO: the quote names the artifact by the reference its Agent's tools take and the version the user looked at, then each element's path and markup in one code block.
  it("names the artifact and version, then each element", () => {
    const quote = artifactPickQuote({ id: "a1", title: "Report" }, 3, [
      heading,
      { selector: "main > section > p", snippet: "<p>First</p>" },
    ]);
    expect(quote).toBe(
      [
        "Report (platform://artifacts/a1, version 3), selected elements:",
        "```html",
        "<!-- h1#title -->",
        '<h1 id="title">Revenue</h1>',
        "<!-- main > section > p -->",
        "<p>First</p>",
        "```",
        "",
      ].join("\n"),
    );
  });

  // TEST_SCENARIO: markup that holds a code fence would close the block early, so the quote uses a longer fence.
  it("uses a longer fence when the markup holds one", () => {
    const quote = artifactPickQuote({ id: "a1", title: "Notes" }, 1, [
      { selector: "pre", snippet: "<pre>```js</pre>" },
    ]);
    expect(quote).toContain("selected element:\n````html\n");
    expect(quote.endsWith("\n````\n")).toBe(true);
  });
});

describe("pick mode in the preview frame", () => {
  function preview(active: boolean) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const render = (on: boolean) =>
      act(() =>
        root.render(
          createElement(DeferredFrame, {
            html: "<p>Hi</p>",
            title: "Report",
            className: "",
            deferMs: 0,
            pick: { active: on, onPick, onCancel },
          }),
        ),
      );
    render(active);
    const frameWindow = host.querySelector("iframe")!.contentWindow!;
    const fromFrame = (data: unknown) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", { data, source: frameWindow }),
        );
      });
    return { onPick, onCancel, render, fromFrame, frameWindow, root };
  }

  // TEST_SCENARIO: turning pick mode on tells the frame to start and off tells it to stop; in between, a pick or a cancel from the frame reaches the panel.
  it("starts and stops the picker and takes its pick or cancel", () => {
    const { onPick, onCancel, fromFrame, frameWindow, render, root } =
      preview(false);
    const postToFrame = vi.spyOn(frameWindow, "postMessage");
    render(true);
    expect(postToFrame).toHaveBeenCalledExactlyOnceWith(
      { type: ARTIFACT_PICK_START_TYPE },
      "*",
    );
    fromFrame({ type: ARTIFACT_PICK_TYPE, elements: [heading] });
    expect(onPick).toHaveBeenCalledExactlyOnceWith([heading]);
    fromFrame({ type: ARTIFACT_PICK_CANCEL_TYPE });
    expect(onCancel).toHaveBeenCalledOnce();
    render(false);
    expect(postToFrame).toHaveBeenLastCalledWith(
      { type: ARTIFACT_PICK_STOP_TYPE },
      "*",
    );
    act(() => root.unmount());
  });

  // TEST_SCENARIO: a page that posts a pick on its own, while the user is not picking, puts nothing in the composer.
  it("ignores a pick while pick mode is off", () => {
    const { onPick, fromFrame, render, root } = preview(false);
    fromFrame({ type: ARTIFACT_PICK_TYPE, elements: [heading] });
    render(true);
    render(false);
    fromFrame({ type: ARTIFACT_PICK_TYPE, elements: [heading] });
    expect(onPick).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
