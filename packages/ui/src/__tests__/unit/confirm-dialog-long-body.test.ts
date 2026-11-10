// @vitest-environment happy-dom
// TEST_OVERVIEW: A confirm dialog with a body taller than the screen keeps its buttons on the screen: the panel is held to the viewport's height and only the body scrolls (#6475).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

/** TEST_SCENARIO: three hundred schedule names in the body; the panel caps its height, the body is the part that scrolls, and the footer with Cancel and Disconnect does not shrink away. */
it("scrolls a long body and keeps the buttons", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      createElement(ConfirmDialog, {
        open: true,
        onOpenChange: () => {},
        kind: "destructive",
        title: "Disconnect AWS Bedrock from this agent?",
        description: createElement(
          "ul",
          null,
          Array.from({ length: 300 }, (_, i) =>
            createElement("li", { key: i }, `review-pr-${i}`),
          ),
        ),
        confirmLabel: "Disconnect",
        onConfirm: () => {},
      }),
    ),
  );
  const panel = document.querySelector<HTMLElement>('[role="alertdialog"]');
  const body = document.querySelector("ul")?.parentElement;
  const disconnect = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Disconnect",
  );
  expect(panel?.className).toMatch(/\bmax-h-\[95dvh\]/);
  expect(panel?.className).toMatch(/\bflex-col\b/);
  expect(body?.className).toMatch(/\boverflow-y-auto\b/);
  expect(body?.className).toMatch(/\bmin-h-0\b/);
  expect(disconnect?.parentElement?.className).toMatch(/\bshrink-0\b/);
});
