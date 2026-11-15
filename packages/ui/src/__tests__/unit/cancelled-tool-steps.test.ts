// @vitest-environment happy-dom
// TEST_OVERVIEW: A step still pending when the turn is cancelled never ran, so it is marked cancelled and left out of the "Edited N files" count.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ActivityGroup } from "../../modules/sessions/components/activity-group.js";
import type { ToolChip } from "../../types.js";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function edit(path: string, status: string): ToolChip {
  return {
    kind: "tool",
    toolCallId: path,
    title: path,
    status,
    toolKind: "edit",
  };
}

function render(chips: ToolChip[]): void {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ActivityGroup, { chips, streaming: false }),
      ),
    ),
  );
}

function label(): string | null {
  return (
    container.querySelector("button[aria-expanded]")?.textContent?.trim() ??
    null
  );
}

// TEST_SCENARIO: the turn was stopped with three writes not yet run.
it("counts only the steps that ran", () => {
  render([
    ...["a.py", "b.py"].map((p) => edit(p, "completed")),
    ...["c.py", "d.py"].map((p) => edit(p, "cancelled")),
  ]);
  expect(label()).toBe("Edited 2 files");
});

// TEST_SCENARIO: the turn was stopped before any step ran.
it("labels a group of cancelled steps", () => {
  render([edit("c.py", "cancelled")]);
  expect(label()).toBe("Cancelled");
});
