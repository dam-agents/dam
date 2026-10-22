// @vitest-environment happy-dom
// TEST_OVERVIEW: The pane's content lags the width it is heading for, so a collapse keeps the tree on screen, clipped by the narrowing pane, until the width has finished animating and only then shows the rail, while an expand shows the tree at once.
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useCollapseContent } from "../../modules/platform/components/sidebar-v2/use-collapse-content.js";

type Hook = ReturnType<typeof useCollapseContent>;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let api: Hook;
let animated = true;

function Probe({ expanded }: { expanded: boolean }) {
  const target = useRef<HTMLDivElement>(null);
  api = useCollapseContent({ expanded, animated, target });
  return createElement("div", { ref: target });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  animated = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(expanded: boolean) {
  act(() => root.render(createElement(Probe, { expanded })));
}

function endWidthTransition() {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "width" });
  act(() => {
    container.firstElementChild?.dispatchEvent(event);
  });
}

// TEST_SCENARIO: the user collapses an expanded pane: the tree stays while the pane narrows, and the rail appears when the width transition ends.
it("keeps the tree until the width transition ends", () => {
  render(true);
  act(() => api.collapse());
  render(false);
  expect(api.contentExpanded).toBe(true);
  expect(api.lagging).toBe(true);

  endWidthTransition();
  expect(api.contentExpanded).toBe(false);
  expect(api.lagging).toBe(false);
});

// TEST_SCENARIO: a pane that animates nothing, because it was already at its width, still swaps, on the fallback timer.
it("swaps on its own when no transition ends", () => {
  render(true);
  act(() => api.collapse());
  render(false);
  act(() => vi.advanceTimersByTime(1000));
  expect(api.contentExpanded).toBe(false);
});

// TEST_SCENARIO: expanding shows the tree at once, and the width follows.
it("shows the tree at the start of an expand", () => {
  render(false);
  render(true);
  expect(api.contentExpanded).toBe(true);
  expect(api.lagging).toBe(false);
});

// TEST_SCENARIO: the user collapses and expands again before the animation ends: the tree stays, and the swap the collapse had waiting never lands.
it("survives a re-toggle mid-animation", () => {
  render(true);
  act(() => api.collapse());
  render(false);
  expect(api.lagging).toBe(true);

  render(true);
  expect(api.contentExpanded).toBe(true);
  expect(api.lagging).toBe(false);

  endWidthTransition();
  act(() => vi.advanceTimersByTime(1000));
  expect(api.contentExpanded).toBe(true);
});

// TEST_SCENARIO: a reader who asked for no motion gets the rail at once.
it("swaps at once when the collapse does not animate", () => {
  animated = false;
  render(true);
  act(() => api.collapse());
  render(false);
  expect(api.contentExpanded).toBe(false);
});

// TEST_SCENARIO: a window too narrow for a pane, or a drag, collapses the pane without the user asking for an animation, and the rail shows at once.
it("swaps at once when the pane collapses for another reason", () => {
  render(true);
  render(false);
  expect(api.contentExpanded).toBe(false);
});
