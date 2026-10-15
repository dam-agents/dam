// TEST_OVERVIEW: A usage stat card keeps its value inside the card: the grid item may shrink below its content, the value may wrap, and the tokens-out part moves to its own line as one piece rather than running past the card's edge.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { SpendStatCards } from "../../modules/metrics/components/spend-stat-cards.js";

const html = renderToStaticMarkup(
  createElement(SpendStatCards, {
    costUsd: 12.34,
    calls: 1234,
    tokensIn: 12_300_000,
    tokensOut: 456_700,
    durationMs: 5_025_000,
  }),
);

it("lets every card shrink below its content", () => {
  const cards = html.match(/<div data-slot="card" class="[^"]*"/g) ?? [];
  expect(cards).toHaveLength(4);
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
