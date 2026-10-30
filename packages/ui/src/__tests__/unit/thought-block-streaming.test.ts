// @vitest-environment happy-dom
// TEST_OVERVIEW: A streaming thinking block opens or stays collapsed by the user's "Thinking while streaming" setting. Collapsed, its header shows the latest line of the thoughts so progress stays visible; either way it folds when the block finishes, unless the user toggled it by hand.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  latestThoughtLine,
  ThoughtBlock,
} from "../../modules/sessions/components/thought-block.js";
import { useStore } from "../../store.js";

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
  useStore.setState({ thinkingExpandedWhileStreaming: true });
});

function render(text: string, streaming: boolean): void {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ThoughtBlock, { text, streaming }),
      ),
    ),
  );
}

function toggle(): HTMLButtonElement {
  const found = container.querySelector("button[aria-expanded]");
  if (!(found instanceof HTMLButtonElement)) throw new Error("no toggle");
  return found;
}

function preview(): string | null {
  return (
    container.querySelector('[data-testid="thought-preview"]')?.textContent ??
    null
  );
}

// TEST_SCENARIO: the default keeps today's behavior — open while streaming, folded once done.
it("opens while streaming by default and folds when done", () => {
  render("first step\nsecond step", true);
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  expect(preview()).toBeNull();
  render("first step\nsecond step", false);
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
});

// TEST_SCENARIO: with the setting off, a streaming block stays collapsed and its header follows the latest line.
it("stays collapsed while streaming and previews the latest line", () => {
  useStore.getState().setThinkingExpandedWhileStreaming(false);
  render("first step", true);
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(preview()).toBe("first step");
  render("first step\nsecond step\n\n", true);
  expect(preview()).toBe("second step");
  render("first step\nsecond step", false);
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(preview()).toBeNull();
});

// TEST_SCENARIO: a block the user opened by hand while collapsed-streaming stays open after it finishes.
it("keeps a hand-opened block open after streaming ends", () => {
  useStore.getState().setThinkingExpandedWhileStreaming(false);
  render("pondering", true);
  act(() => toggle().click());
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  expect(preview()).toBeNull();
  render("pondering", false);
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
});

// TEST_SCENARIO: the preview skips trailing blank lines and trims the line it picks.
it("picks the last line that holds text", () => {
  expect(latestThoughtLine("a\n  b  \n\n  \n")).toBe("b");
  expect(latestThoughtLine("")).toBe("");
});
