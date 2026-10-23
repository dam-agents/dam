// @vitest-environment happy-dom
// TEST_OVERVIEW: Settings / Providers checks the keys it can check once each time the page opens, so a key that stopped working reads as refused without the user pressing Recheck. A re-render, a refetch or the finished check does not check again; leaving the page and returning does. A page with nothing to check, or one still loading, checks nothing.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useRecheckOnOpen } from "../../modules/providers/hooks/use-recheck-on-open.js";

function Probe({
  recheck,
  ready,
}: {
  recheck: () => void;
  ready: boolean;
}): null {
  useRecheckOnOpen(recheck, ready);
  return null;
}

function mount(recheck: () => void, ready: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const draw = (nextReady: boolean) =>
    act(() => root.render(createElement(Probe, { recheck, ready: nextReady })));
  draw(ready);
  return {
    draw,
    unmount: () => act(() => root.unmount()),
  };
}

// TEST_SCENARIO: the page checks once it knows what it can check, and neither its own re-renders nor a finished check check again.
it("checks once per open", () => {
  const recheck = vi.fn();
  const page = mount(recheck, false);
  expect(recheck).not.toHaveBeenCalled();
  page.draw(true);
  page.draw(true);
  page.draw(true);
  expect(recheck).toHaveBeenCalledTimes(1);
});

// TEST_SCENARIO: a page with no key it can check asks the server for nothing, so a Connection without a key check never triggers a recheck.
it("checks nothing without a checkable key", () => {
  const recheck = vi.fn();
  mount(recheck, false);
  expect(recheck).not.toHaveBeenCalled();
});

// TEST_SCENARIO: leaving the page and opening it again is a fresh open, so the keys are checked again.
it("checks again on a new open", () => {
  const recheck = vi.fn();
  const first = mount(recheck, true);
  first.unmount();
  mount(recheck, true);
  expect(recheck).toHaveBeenCalledTimes(2);
});
