// @vitest-environment happy-dom
// TEST_OVERVIEW: The CurveBender notice above the chat input offers the Try action until the person closes it, which keeps it closed in this browser. It says only the first sentence when the input already runs on CurveBender, and the variant it first showed stays for as long as it is up, whatever the selection does next.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const { CurveBenderAlert } =
  await import("../../modules/sessions/components/curve-bender-alert.js");
const { getBrand } = await import("../../brand.js");

const DOCS_URL =
  "https://cb-docs-curvebender.apps.fmaas-backend.fmaas.res.ibm.com/ai-platform-incubation/cb_docs/";

let container: HTMLDivElement;
let root: Root;

function render(selected: boolean | null, visible = true) {
  act(() =>
    root.render(
      createElement(CurveBenderAlert, { visible, selected, onTry: () => {} }),
    ),
  );
}

function tryButton() {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Try DeepSeek 4.1 Flash"),
  );
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the CurveBender notice", () => {
  // TEST_SCENARIO: a chat without CurveBender selected offers the action, beside a link to the documentation, and names this install's brand.
  it("offers the Try action", () => {
    render(false);
    expect(container.textContent).toContain(
      `now provides ${getBrand().name} users with open-source models running on IBM infrastructure.`,
    );
    expect(tryButton()).toBeDefined();
    expect(container.textContent).toContain("now!");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(DOCS_URL);
  });

  // TEST_SCENARIO: a chat already running on CurveBender shows the first sentence only, with no action to take.
  it("shows the first sentence when CurveBender is selected", () => {
    render(true);
    expect(container.textContent).toContain("now provides");
    expect(container.textContent).not.toContain("Try DeepSeek");
  });

  // TEST_SCENARIO: the variant is picked when the notice appears, so a selection made later never rewrites the sentence under the reader.
  it("keeps the Try variant when CurveBender is selected later", () => {
    render(false);
    render(true);
    expect(tryButton()).toBeDefined();
  });

  it("keeps the first-sentence variant when CurveBender is deselected later", () => {
    render(true);
    render(false);
    expect(container.textContent).not.toContain("Try DeepSeek");
  });

  // TEST_SCENARIO: the notice waits until the composer knows what the input runs on, so it never freezes the wrong sentence, and an install without the shared provider never shows it.
  it("waits for the selection, and hides where the install ships no CurveBender", () => {
    render(null);
    expect(container.textContent).toBe("");
    render(false, false);
    expect(container.textContent).toBe("");
    render(false);
    expect(tryButton()).toBeDefined();
  });

  // TEST_SCENARIO: closing the notice keeps it closed after a reload, because the dismissal is saved in this browser.
  it("stays closed once dismissed", () => {
    render(false);
    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss the CurveBender notice"]',
    );
    expect(dismiss).toBeTruthy();
    act(() => dismiss!.click());
    expect(container.textContent).toBe("");
    act(() => root.unmount());
    root = createRoot(container);
    render(false);
    expect(container.textContent).toBe("");
  });
});
