// TEST_OVERVIEW: The warning shown before a provider is detached from an agent stays short: each list names at most five entries and counts the rest (#6475).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { DetachProviderMessage } from "../../modules/sessions/components/detach-provider-message.js";

const render = (schedules: string[]) =>
  renderToStaticMarkup(
    createElement(DetachProviderMessage, {
      name: "AWS Bedrock",
      usage: { kinds: [], schedules, pages: [], profiles: [] },
    }),
  );

const names = (n: number) =>
  Array.from({ length: n }, (_, i) => `review-pr-${i + 1}`);

/** TEST_SCENARIO: an agent with hundreds of schedules on the provider gets four names and a count, not a list taller than the screen. */
it("names four schedules of many and counts the rest", () => {
  const html = render(names(300));
  expect(html.match(/<li>/g)).toHaveLength(5);
  expect(html).toContain("<li>review-pr-4</li>");
  expect(html).not.toContain("review-pr-5<");
  expect(html).toContain("<li>and 296 more</li>");
});

/** TEST_SCENARIO: five names fit as they are, so none is replaced by "and 1 more". */
it("names all five when there are five", () => {
  const html = render(names(5));
  expect(html.match(/<li>/g)).toHaveLength(5);
  expect(html).toContain("<li>review-pr-5</li>");
  expect(html).not.toContain("more");
});
