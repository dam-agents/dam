// @vitest-environment happy-dom
// TEST_OVERVIEW: The warning shown before a provider is detached from an agent stays short: each list names at most five entries, then a quiet count with a link to the agent's Schedules, and says what turned-off schedules on it would do (#6475).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  closeDialog: vi.fn(),
  navigateToSandboxHome: vi.fn(),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select(state),
}));

import { DetachProviderMessage } from "../../modules/sessions/components/detach-provider-message.js";

const message = (schedules: string[], turnedOffSchedules = 0) =>
  createElement(DetachProviderMessage, {
    agentId: "agent-1",
    name: "AWS Bedrock",
    usage: {
      kinds: [],
      schedules,
      turnedOffSchedules,
      pages: [],
      profiles: [],
    },
  });

const names = (n: number) =>
  Array.from({ length: n }, (_, i) => `review-pr-${i + 1}`);

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

/** TEST_SCENARIO: an agent with hundreds of schedules on the provider gets four names and a count, not a list taller than the screen; the count is a line of its own, not a bullet. */
it("names four schedules of many and counts the rest outside the list", () => {
  const html = renderToStaticMarkup(message(names(300)));
  expect(html.match(/<li>/g)).toHaveLength(4);
  expect(html).toContain("<li>review-pr-4</li>");
  expect(html).not.toContain("review-pr-5<");
  expect(html).toMatch(/<\/ul><p[^>]*>and 296 more/);
});

/** TEST_SCENARIO: five names fit as they are, so none is replaced by "and 1 more". */
it("names all five when there are five", () => {
  const html = renderToStaticMarkup(message(names(5)));
  expect(html.match(/<li>/g)).toHaveLength(5);
  expect(html).toContain("<li>review-pr-5</li>");
  expect(html).not.toContain("more");
});

/** TEST_SCENARIO: the count links to the agent's Schedules page, where every name is; following it closes the dialog without disconnecting. */
it("opens the agent's Schedules from the count", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(message(names(9))));
  const link = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "See all in Schedules",
  );
  act(() => link?.click());
  expect(state.closeDialog).toHaveBeenCalledWith(false);
  expect(state.navigateToSandboxHome).toHaveBeenCalledWith(
    "agent-1",
    "schedules",
  );
});

/** TEST_SCENARIO: turned-off schedules on the provider are not named, but one sentence warns that turning them back on runs them on nothing; with none, the sentence is absent. */
it("warns about turned-off schedules on the provider", () => {
  expect(renderToStaticMarkup(message([], 3))).toContain(
    "3 turned-off schedules use it too. Turned back on, they won’t run until AWS Bedrock is attached again or they get another model.",
  );
  expect(renderToStaticMarkup(message([], 1))).toContain(
    "1 turned-off schedule uses it too. Turned back on, it won’t run until AWS Bedrock is attached again or it gets another model.",
  );
  expect(renderToStaticMarkup(message(["Nightly"]))).not.toContain(
    "turned-off",
  );
});

/** TEST_SCENARIO: the dialog's header centres its text on a phone; the lists stay left-aligned at every width. */
it("keeps the lists left-aligned", () => {
  const html = renderToStaticMarkup(message(names(9)));
  expect(html).toMatch(/<div class="[^"]*\btext-left\b[^"]*"><ul/);
});
