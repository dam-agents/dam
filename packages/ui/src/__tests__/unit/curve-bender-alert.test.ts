// @vitest-environment happy-dom
// TEST_OVERVIEW: The CurveBender notice above a new chat's composer has two variants. "setup" says the chat already runs on the shared CurveBender and offers the picker, "offer" offers Try now; both state that the models are approved for restricted use cases only, linking that phrase to the legal page. Each closes on its own and stays closed in this browser.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const { CurveBenderAlert } =
  await import("../../modules/sessions/components/curve-bender-alert.js");

const DOCS_URL =
  "https://cb-docs-curvebender.apps.fmaas-backend.fmaas.res.ibm.com/ai-platform-incubation/cb_docs/";
const RESTRICTIONS_URL =
  "https://cb-docs-curvebender.apps.fmaas-backend.fmaas.res.ibm.com/ai-platform-incubation/cb_docs/getting-started/model-usage-guidance/";

type Variant = "setup" | "offer" | null;

let container: HTMLDivElement;
let root: Root;

function render(variant: Variant, onTry = async () => true) {
  const tryIt = vi.fn(onTry);
  const onPickProvider = vi.fn();
  act(() =>
    root.render(
      createElement(CurveBenderAlert, {
        variant,
        onTry: tryIt,
        onPickProvider,
      }),
    ),
  );
  return { onTry: tryIt, onPickProvider };
}

function expectRestriction() {
  expect(container.textContent).toContain(
    "These models are currently only approved for restricted use cases.",
  );
  const link = [...container.querySelectorAll("a")].find(
    (a) => a.textContent === "restricted use cases",
  );
  expect(link?.getAttribute("href")).toBe(RESTRICTIONS_URL);
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  );
  expect(found).toBeTruthy();
  return found!;
}

async function click(element: HTMLButtonElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dismiss() {
  const found = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Dismiss the CurveBender notice"]',
  );
  expect(found).toBeTruthy();
  act(() => found!.click());
}

function remount(variant: Variant) {
  act(() => root.unmount());
  root = createRoot(container);
  render(variant);
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
  // TEST_SCENARIO: a chat already on the shared Connection says so, and its one action opens the picker instead of touching the pair.
  it("tells a chat on CurveBender that it is set up", async () => {
    const { onPickProvider, onTry } = render("setup");
    expect(
      container
        .querySelector('[data-testid="curve-bender-alert"]')
        ?.getAttribute("data-variant"),
    ).toBe("setup");
    expect(container.textContent).toContain(
      "You're set up with CurveBender, IBM-hosted open-source models. Start chatting, or switch providers anytime.",
    );
    expect(container.textContent).not.toContain("Try now");
    const learnMore = [...container.querySelectorAll("a")].find(
      (a) => a.textContent === "Learn more",
    );
    expect(learnMore?.getAttribute("href")).toBe(DOCS_URL);
    expect(learnMore?.getAttribute("target")).toBe("_blank");
    expect(learnMore?.getAttribute("rel")).toBe("noopener noreferrer");
    expectRestriction();
    await click(button("Use a different provider"));
    expect(onPickProvider).toHaveBeenCalledTimes(1);
    expect(onTry).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a chat on another provider is offered CurveBender, and Try now is disabled from the click until the change applies, then offered again.
  it("offers CurveBender to a chat on another provider", async () => {
    let applied: (value: boolean) => void = () => {};
    const { onTry, onPickProvider } = render(
      "offer",
      () => new Promise<boolean>((resolve) => (applied = resolve)),
    );
    expect(
      container
        .querySelector('[data-testid="curve-bender-alert"]')
        ?.getAttribute("data-variant"),
    ).toBe("offer");
    expect(container.textContent).toContain(
      "You can now use CurveBender, IBM-hosted open-source models.",
    );
    expect(container.textContent).not.toContain("Use a different provider");
    const learnMore = [...container.querySelectorAll("a")].find(
      (a) => a.textContent === "Learn more",
    );
    expect(learnMore?.getAttribute("href")).toBe(DOCS_URL);
    expectRestriction();
    expect(button("Try now").disabled).toBe(false);
    await click(button("Try now"));
    expect(onTry).toHaveBeenCalledTimes(1);
    expect(button("Try now").disabled).toBe(true);
    await act(async () => {
      applied(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(button("Try now").disabled).toBe(false);
    expect(onPickProvider).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the two variants are separate asks, so closing one leaves the other to be read, before and after a reload.
  it("keeps each variant's close in this browser alone", () => {
    render("setup");
    dismiss();
    expect(
      container.querySelector('[data-testid="curve-bender-alert"]'),
    ).toBeNull();
    remount("setup");
    expect(
      container.querySelector('[data-testid="curve-bender-alert"]'),
    ).toBeNull();
    remount("offer");
    expect(container.textContent).toContain("Try now");
    dismiss();
    remount("offer");
    expect(
      container.querySelector('[data-testid="curve-bender-alert"]'),
    ).toBeNull();
  });

  // TEST_SCENARIO: a person who closed the notice before it stated the restriction sees it again, so nobody keeps using CurveBender without having read the statement.
  it("shows the restriction to those who closed the earlier notice", () => {
    localStorage.setItem("platform-curvebender-setup-dismissed", "1");
    localStorage.setItem("platform-curvebender-alert-dismissed", "1");
    render("setup");
    expectRestriction();
    remount("offer");
    expectRestriction();
  });

  // TEST_SCENARIO: an existing chat, or an install without the shared provider, has no variant and so shows nothing.
  it("renders nothing without a variant", () => {
    render(null);
    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});
