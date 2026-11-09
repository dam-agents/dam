// @vitest-environment happy-dom
// TEST_OVERVIEW: The shared Tooltip opens on keyboard focus only, and a Tooltip held shut leaves its trigger's focus alone, so a menu row it wraps still highlights.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { Tooltip, TooltipProvider } from "../../components/ui/tooltip.js";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function focusPrevented(open: boolean | undefined): boolean {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  let prevented = false;
  act(() =>
    root.render(
      createElement(
        "div",
        {
          onFocus: (event: FocusEvent) => {
            prevented = event.defaultPrevented;
          },
        },
        createElement(
          TooltipProvider,
          null,
          createElement(Tooltip, {
            content: "Reason",
            open,
            children: createElement("button", { type: "button" }, "Row"),
          }),
        ),
      ),
    ),
  );
  const button = container.querySelector("button")!;
  Object.defineProperty(button, "matches", {
    value: (selector: string) =>
      selector !== ":focus-visible" &&
      Element.prototype.matches.call(button, selector),
  });
  act(() => button.focus());
  return prevented;
}

/** TEST_SCENARIO: a focus that is not from the keyboard (happy-dom calls every focus :focus-visible, so the test stubs it off) does not open the tooltip, so the guard stops it; a tooltip held shut has nothing to stop and lets the focus through. */
it("guards a mouse focus only while the tooltip can open", () => {
  expect(focusPrevented(undefined)).toBe(true);
  expect(focusPrevented(false)).toBe(false);
});
