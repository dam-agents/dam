// @vitest-environment happy-dom
// TEST_OVERVIEW: A panel section's heading draws its count beside the name but keeps the add button's test id and accessible name on the name alone, so a test or a screen reader sees the same thing whether the section holds three rows or thirty; and an add button waits while a save is pending.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { SectionHeading } from "../../components/ui/section-heading.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Parameters<typeof SectionHeading>[0]): void {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(SectionHeading, props),
      ),
    ),
  );
}

function addButton(): HTMLButtonElement {
  const found = container.querySelector("button");
  if (!found) throw new Error("no add button rendered");
  return found;
}

// TEST_SCENARIO: the count belongs to the text, not to the name the button answers to.
it("shows the count beside the name and keeps the add button's name and id on the name", () => {
  render({
    label: "Network access",
    count: 100,
    addLabel: "Add network access",
    onAdd: () => {},
  });
  expect(container.textContent).toBe("Network access (100)");
  expect(addButton().getAttribute("aria-label")).toBe("Add network access");
  expect(addButton().dataset.testid).toBe("section-add-network-access");
});

// TEST_SCENARIO: a section whose count moves does not move its add button's id.
it("keeps the add button's id when the count changes", () => {
  render({
    label: "Environment variables",
    count: 1,
    addLabel: "Create variable",
    onAdd: () => {},
  });
  const first = addButton().dataset.testid;
  render({
    label: "Environment variables",
    count: 39,
    addLabel: "Create variable",
    onAdd: () => {},
  });
  expect(addButton().dataset.testid).toBe(first);
  expect(container.textContent).toBe("Environment variables (39)");
});

// TEST_SCENARIO: a heading with no count draws the name alone.
it("draws the name alone when there is no count", () => {
  render({ label: "Providers", addLabel: "Add provider", onAdd: () => {} });
  expect(container.textContent).toBe("Providers");
});

// TEST_SCENARIO: the add button waits while a save is pending.
it("disables the add button while a save is pending", () => {
  render({
    label: "Environment variables",
    count: 39,
    addLabel: "Create variable",
    onAdd: () => {},
    addDisabled: true,
  });
  expect(addButton().disabled).toBe(true);
});

// TEST_SCENARIO: no heading carries copy under it unless it is given some.
it("draws no copy under the name", () => {
  render({ label: "Network access", count: 100 });
  expect(container.querySelector("p")).toBe(null);
  expect(container.querySelector("button")).toBe(null);
});
