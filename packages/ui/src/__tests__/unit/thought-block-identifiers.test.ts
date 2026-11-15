// @vitest-environment happy-dom
// TEST_OVERVIEW: Reasoning text is shown as it was written, so an identifier such as `__init__.py` keeps its underscores instead of becoming bold "init".
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ThoughtBlock } from "../../modules/sessions/components/thought-block.js";

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

// TEST_SCENARIO: a thought about a Python package mentions a dunder file in bare text.
it("keeps underscores in a thought", () => {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ThoughtBlock, {
          text: "Write __init__.py and call Path(__file__).",
          streaming: true,
        }),
      ),
    ),
  );
  expect(container.textContent).toContain("__init__.py");
  expect(container.textContent).toContain("Path(__file__)");
  expect(container.querySelector("strong")).toBeNull();
});
