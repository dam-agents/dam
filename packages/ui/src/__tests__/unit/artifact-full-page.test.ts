// @vitest-environment happy-dom
// TEST_OVERVIEW: The Full page button in the artifact preview bar lays the preview over the whole browser window and takes it back. Escape takes it back too, except while a dialog is open above it, so Escape closes only that dialog.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { FullPageButton } from "../../modules/artifacts/components/full-page-button.js";
import { useFullPage } from "../../modules/artifacts/hooks/use-full-page.js";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Harness() {
  const { fullPage, toggleFullPage } = useFullPage();
  return createElement(FullPageButton, { fullPage, onToggle: toggleFullPage });
}

const button = () => host.querySelector("button")!;
const pressEscape = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(createElement(TooltipProvider, null, createElement(Harness))),
  );
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

// TEST_SCENARIO: the user opens the preview over the whole window with the button, then leaves it with Escape.
it("enters full page from the button and leaves it on Escape", () => {
  act(() => button().click());
  expect(button().getAttribute("aria-label")).toBe("Exit full page");
  pressEscape();
  expect(button().getAttribute("aria-label")).toBe("Full page");
});

// TEST_SCENARIO: the user opens the Share dialog from the full page preview and presses Escape; the dialog closes and the preview stays over the whole window.
it("stays full page on Escape while a dialog is open", () => {
  act(() => button().click());
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  pressEscape();
  expect(button().getAttribute("aria-label")).toBe("Exit full page");
});
