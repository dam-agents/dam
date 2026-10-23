// @vitest-environment happy-dom
// TEST_OVERVIEW: The Full page button in the artifact preview bar lays the preview over the whole browser window and takes it back. Escape takes it back too, except while a dialog is open above it, so Escape closes only that dialog. A change of side panel tab hides the dock and ends full page, so the preview does not open again over the window.
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { FullPageButton } from "../../modules/artifacts/components/full-page-button.js";
import { useFullPage } from "../../modules/artifacts/hooks/use-full-page.js";
import { useStore } from "../../store.js";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const { fullPage, toggleFullPage } = useFullPage(ref);
  return createElement(
    "div",
    { ref },
    createElement(FullPageButton, { fullPage, onToggle: toggleFullPage }),
  );
}

const button = () => host.querySelector("button")!;
const pressEscape = () => {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    cancelable: true,
  });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
};

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

// TEST_SCENARIO: the user opens the preview over the whole window with the button, which keeps the keyboard and shows its tooltip; the first Escape closes the tooltip, the next leaves full page and is consumed, so the side panel on a phone stays open under it.
it("enters full page from the button and leaves it on Escape", () => {
  act(() => button().click());
  expect(document.activeElement).toBe(button());
  pressEscape();
  expect(button().getAttribute("aria-label")).toBe("Exit full page");
  expect(pressEscape().defaultPrevented).toBe(true);
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

// TEST_SCENARIO: the user opens full page, and then an event opens another side panel tab, which hides the dock; full page ends, so the dock opens again in the panel.
it("leaves full page when the side panel tab changes", () => {
  act(() => button().click());
  act(() => useStore.getState().setSidePanelTab("files"));
  expect(button().getAttribute("aria-label")).toBe("Full page");
});
