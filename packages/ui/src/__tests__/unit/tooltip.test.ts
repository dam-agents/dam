// @vitest-environment happy-dom
// TEST_OVERVIEW: The shared Tooltip opens on keyboard focus and on hover, never on a mouse focus, and shows only while it has content. It never cancels its trigger's focus, so a menu row it wraps still highlights.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "../../components/ui/dropdown-menu.js";
import { Tooltip, TooltipProvider } from "../../components/ui/tooltip.js";

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

function render(element: ReactNode) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => root!.render(createElement(TooltipProvider, null, element)));
}

function mouseFocus(element: HTMLElement) {
  Object.defineProperty(element, "matches", {
    value: (selector: string) =>
      selector !== ":focus-visible" &&
      Element.prototype.matches.call(element, selector),
  });
  act(() => element.focus());
}

const tooltip = () => document.querySelector('[role="tooltip"]');

/** TEST_SCENARIO: the pointer focuses a menu row as it moves over it (happy-dom calls every focus :focus-visible, so the test stubs it off); the row with a tooltip still highlights like any other row, and the tooltip waits for the hover instead of opening on that focus. */
it("lets a mouse-focused menu row highlight without opening its tooltip", () => {
  render(
    createElement(
      DropdownMenu,
      { open: true },
      createElement(
        DropdownMenuContent,
        null,
        createElement(
          DropdownMenuRadioGroup,
          { value: "" },
          createElement(Tooltip, {
            content: "Reason",
            children: createElement(
              DropdownMenuRadioItem,
              { value: "row" },
              "Row",
            ),
          }),
        ),
      ),
    ),
  );
  const row = document.querySelector<HTMLElement>('[role="menuitemradio"]')!;
  mouseFocus(row);
  expect(row.hasAttribute("data-highlighted")).toBe(true);
  expect(tooltip()).toBeNull();
});

/** TEST_SCENARIO: a focused trigger whose tooltip has no content shows nothing, and shows the content as soon as it gets some, with no new focus or hover. */
it("shows a focused trigger's content as soon as it has some", () => {
  const button = (content: string | null) =>
    createElement(Tooltip, {
      content,
      children: createElement("button", { type: "button" }, "Row"),
    });
  render(button(null));
  act(() => container!.querySelector("button")!.focus());
  expect(tooltip()).toBeNull();
  render(button("Reason"));
  expect(tooltip()?.textContent).toBe("Reason");
});
