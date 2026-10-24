// @vitest-environment happy-dom
// TEST_OVERVIEW: A rejected provider key error card points at Settings › Providers with a real link. The link is an anchor to the providers settings route, so it reads as a link and works from the keyboard. A click in the same tab opens the providers settings through the app router; a click that asks for a new tab leaves the browser to the href. The pointer renders once, whether it sits in the hint or in the message the agent runtime prefixed.
import { AUTH_ERROR_HINT } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ navigateToSettings: vi.fn() }));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select(fake),
}));
vi.mock("../../modules/sessions/hooks/use-spend-refusal-viewer.js", () => ({
  useSpendRefusalViewer: () => ({ role: "owner" }),
}));

const { SendErrorCard } =
  await import("../../modules/sessions/components/send-error-card.js");

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
  fake.navigateToSettings.mockClear();
});

function render(rawError: string): void {
  act(() =>
    root.render(createElement(SendErrorCard, { rawError, interrupted: false })),
  );
}

function link(): HTMLAnchorElement {
  const found = container.querySelector("a");
  if (!found) throw new Error("no link rendered");
  return found;
}

const BARE_401 = "API error: 401 Unauthorized: invalid x-api-key";

it("renders the providers pointer as an anchor to the providers settings", () => {
  render(BARE_401);
  expect(link().textContent).toBe("Settings › Providers");
  expect(link().getAttribute("href")).toBe("/settings/providers");
});

it("opens the providers settings when the link is clicked", () => {
  render(BARE_401);
  act(() =>
    link().dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );
  expect(fake.navigateToSettings).toHaveBeenCalledWith("providers");
});

it("leaves a click that asks for a new tab to the browser", () => {
  render(BARE_401);
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    metaKey: true,
  });
  act(() => link().dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(fake.navigateToSettings).not.toHaveBeenCalled();
});

it("links the pointer the agent runtime put into the message", () => {
  render(`${AUTH_ERROR_HINT}\n\nError: API error: 401 authentication_error`);
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(link().getAttribute("href")).toBe("/settings/providers");
});

it("leaves other send errors without a link", () => {
  render("API error: 402 Payment Required");
  expect(container.querySelector("a")).toBeNull();
});
