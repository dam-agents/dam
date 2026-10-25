// @vitest-environment happy-dom
// TEST_OVERVIEW: The artifact preview frame in the app runs the artifact sandboxed, but a link it opens in a new tab leaves the sandbox, so a link to another shared artifact loads in that tab like a pasted address.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { DeferredFrame } from "../../modules/artifacts/components/deferred-frame.js";

vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useCallAgentApi: () => ({ mutateAsync: vi.fn() }),
}));

afterEach(() => {
  document.body.replaceChildren();
});

// TEST_SCENARIO: the user opens an artifact whose link points to another shared artifact; the preview lets the new tab escape the sandbox and still keeps the artifact off the app's origin.
it("lets popups escape the sandbox without granting same-origin", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(DeferredFrame, {
        html: "<a href='https://share.example.com/a/x' target='_blank'>x</a>",
        title: "Catalog",
        className: "",
        deferMs: 0,
      }),
    ),
  );
  const tokens = host
    .querySelector("iframe")!
    .getAttribute("sandbox")!
    .split(" ");
  expect(tokens).toContain("allow-popups-to-escape-sandbox");
  expect(tokens).not.toContain("allow-same-origin");
  act(() => root.unmount());
});
