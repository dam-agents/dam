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

function pointerState(element: HTMLElement, hover: boolean) {
  Object.defineProperty(element, "matches", {
    value: (selector: string) =>
      selector === ":hover"
        ? hover
        : selector !== ":focus-visible" &&
          Element.prototype.matches.call(element, selector),
  });
}

function mouseFocus(element: HTMLElement) {
  pointerState(element, false);
  act(() => element.focus());
}

function menuRow() {
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
  return document.querySelector<HTMLElement>('[role="menuitemradio"]')!;
}

const tooltip = () => document.querySelector('[role="tooltip"]');

/** TEST_SCENARIO: a menu row gets a focus that is neither from the keyboard nor under the pointer, as when a closing menu returns focus (happy-dom calls every focus :focus-visible, so the test stubs it off); the row still highlights like any other row, and its tooltip stays shut. */
it("lets a mouse-focused menu row highlight without opening its tooltip", () => {
  const row = menuRow();
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

/** TEST_SCENARIO: the pointer moves onto a menu row, and the row focuses itself on that move; its tooltip opens, because this focus comes from the hover. */
it("opens a hovered menu row's tooltip", () => {
  const row = menuRow();
  pointerState(row, true);
  act(() => {
    row.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
    );
  });
  expect(document.activeElement).toBe(row);
  expect(tooltip()?.textContent).toBe("Reason");
});
