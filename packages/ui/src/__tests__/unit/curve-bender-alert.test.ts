// @vitest-environment happy-dom
// TEST_OVERVIEW: The CurveBender notice above the chat input always offers Try now, which applies CurveBender and then thanks the person with the community channel. Closing the notice keeps it closed in this browser, and an install without the shared provider never shows it.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../modules/links/api/queries.js",
  () => import("./support/fake-links.js"),
);
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const { CurveBenderAlert } =
  await import("../../modules/sessions/components/curve-bender-alert.js");
const { getBrand } = await import("../../brand.js");
const { CHART_DEFAULT_LINKS, fakeLinks } =
  await import("./support/fake-links.js");

const COMMUNITY_URL = "https://ibm.enterprise.slack.com/archives/C0C3E4VJAR1";
const DOCS_URL =
  "https://cb-docs-curvebender.apps.fmaas-backend.fmaas.res.ibm.com/ai-platform-incubation/cb_docs/";

let container: HTMLDivElement;
let root: Root;

function render(visible: boolean, applied: boolean) {
  const onTry = vi.fn(async () => applied);
  act(() => root.render(createElement(CurveBenderAlert, { visible, onTry })));
  return onTry;
}

async function clickTry() {
  const tryButton = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Try now"),
  );
  expect(tryButton).toBeTruthy();
  await act(async () => {
    tryButton!.click();
    await Promise.resolve();
    await Promise.resolve();
  });
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
  fakeLinks.current = { ...CHART_DEFAULT_LINKS };
});

describe("the CurveBender notice", () => {
  // TEST_SCENARIO: the notice names this install's brand, links the documentation, and always offers Try now.
  it("offers Try now with the branded copy", () => {
    render(true, true);
    expect(container.textContent).toContain(
      `now provides ${getBrand().name} with open-source models on IBM infra.`,
    );
    expect(container.textContent).not.toContain("users");
    expect(container.textContent).not.toContain("running");
    expect(container.textContent).not.toContain("infrastructure");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(DOCS_URL);
    expect(container.textContent).toContain("Try now");
  });

  // TEST_SCENARIO: Try applies CurveBender, then thanks the person and points at the community channel.
  it("applies CurveBender and thanks the person", async () => {
    const onTry = render(true, true);
    await clickTry();
    expect(onTry).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Thank you for trying CurveBender!",
    );
    expect(document.body.textContent).toContain(
      "Your agent is now set to use CurveBender. Change provider anytime using the picker at the bottom of the page.",
    );
    const community = [...document.body.querySelectorAll("a")].find(
      (a) => a.textContent === "#curvebender-community",
    );
    expect(community?.getAttribute("href")).toBe(COMMUNITY_URL);
  });

  // TEST_SCENARIO: an install that names no community channel thanks the person without inviting them anywhere.
  it("thanks without a channel when the install names none", async () => {
    fakeLinks.current = { ...CHART_DEFAULT_LINKS, curveBenderCommunity: null };
    render(true, true);
    await clickTry();
    expect(document.body.textContent).toContain(
      "Thank you for trying CurveBender!",
    );
    expect(document.body.textContent).not.toContain("#curvebender-community");
  });

  // TEST_SCENARIO: a Try that could not apply CurveBender says nothing about the agent being set to it.
  it("thanks nobody when the change did not apply", async () => {
    render(true, false);
    await clickTry();
    expect(document.body.textContent).not.toContain(
      "Your agent is now set to use CurveBender",
    );
  });

  // TEST_SCENARIO: closing the notice keeps it closed after a reload, because the dismissal is saved in this browser.
  it("stays closed once dismissed", () => {
    render(true, true);
    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss the CurveBender notice"]',
    );
    expect(dismiss).toBeTruthy();
    act(() => dismiss!.click());
    expect(container.textContent).toBe("");
    act(() => root.unmount());
    root = createRoot(container);
    render(true, true);
    expect(container.textContent).toBe("");
  });

  // TEST_SCENARIO: an install without the shared provider never shows the notice.
  it("hides where the install ships no CurveBender", () => {
    render(false, true);
    expect(container.textContent).toBe("");
  });
});
