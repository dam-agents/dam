// @vitest-environment happy-dom
// TEST_OVERVIEW: A confirm dialog with a body taller than the screen keeps its buttons on the screen: the panel is held to the viewport's height, only the body scrolls, and its bottom edge fades while more is below; Cancel comes before the confirm button (#6475).
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

/** TEST_SCENARIO: on a phone the footer stacks its buttons; Cancel comes first, so the destructive button is not the one on top, and no reversed column puts it there. */
it("puts Cancel before the confirm button", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      createElement(ConfirmDialog, {
        open: true,
        onOpenChange: () => {},
        kind: "destructive",
        title: "Disconnect?",
        confirmLabel: "Disconnect",
        onConfirm: () => {},
      }),
    ),
  );
  const buttons = [...document.querySelectorAll("button")];
  expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Disconnect"]);
  expect(buttons[0]?.parentElement?.className).not.toMatch(/flex-col-reverse/);
});

/** TEST_SCENARIO: a body with more below its bottom edge fades there, so the person sees it scrolls; scrolled to the end, the fade goes. */
it("fades the body's bottom edge while more is below", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const metrics = { scrollHeight: 2000, clientHeight: 300, scrollTop: 0 };
  for (const key of Object.keys(metrics) as (keyof typeof metrics)[])
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get: () => metrics[key],
    });
  try {
    act(() =>
      root?.render(
        createElement(ConfirmDialog, {
          open: true,
          onOpenChange: () => {},
          title: "Disconnect?",
          description: createElement(
            "ul",
            null,
            createElement("li", null, "x"),
          ),
          onConfirm: () => {},
        }),
      ),
    );
    const body = document.querySelector("ul")?.parentElement;
    expect(body?.dataset.moreBelow).toBe("true");
    expect(body?.className).toMatch(/mask-image/);
    metrics.scrollTop = 1700;
    act(() => body?.dispatchEvent(new Event("scroll")));
    expect(body?.dataset.moreBelow).toBeUndefined();
    expect(body?.className).not.toMatch(/mask-image/);
  } finally {
    for (const key of Object.keys(metrics))
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
});
