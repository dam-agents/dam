// TEST_OVERVIEW: A usage stat card keeps its value inside the card: the grid item may shrink below its content, the value may wrap, and the tokens-out part moves to its own line as one piece rather than running past the card's edge.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { MeasuredStatCards } from "../../modules/spend/components/measured-stat-cards.js";

const html = renderToStaticMarkup(
  createElement(MeasuredStatCards, {
    totals: [
      {
        unit: "usd",
        costMicros: 12_340_000,
        calls: 1234,
        estimatedCalls: 0,
        uncachedInputTokens: 2_300_000,
        outputTokens: 456_700,
        cacheReadTokens: 10_000_000,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        webSearches: 0,
      },
    ],
  }),
);

it("lets every card shrink below its content", () => {
  const cards = html.match(/<div data-slot="card" class="[^"]*"/g) ?? [];
  expect(cards).toHaveLength(2);
  for (const card of cards) expect(card).toContain("min-w-0");
});

it("lets the value wrap", () => {
  expect(html).toContain("<dd");
  expect(html).not.toMatch(/<dd class="[^"]*whitespace-nowrap/);
});

it("breaks the tokens pair before the out part and keeps that part whole", () => {
  expect(html).toMatch(
    /12\.3M<wbr\/><span[^>]*><span class="whitespace-nowrap"><span class="mx-1">\/<\/span>456\.7K<\/span><\/span>/,
  );
});
