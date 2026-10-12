// TEST_OVERVIEW: the kit browser lists starter kits in one fixed order — Software,
// TEST_OVERVIEW: Knowledge, Productivity, Research — and alphabetically by name inside a
// TEST_OVERVIEW: category, whatever order the resolved catalog rows arrived in.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  categoriesPresent,
  sortKits,
} from "../../modules/starter-kits/lib/catalog-cards.js";

const kit = (name: string, category: StarterKitView["category"]) =>
  ({ id: name.toLowerCase(), name, category }) as unknown as StarterKitView;

const catalog = [
  kit("ShinkaEvolve", "research"),
  kit("Inbox Triage", "productivity"),
  kit("Code Guardian", "software"),
  kit("Plain Wiki", "knowledge"),
  kit("AdaEvolve", "research"),
  kit("llm wiki", "knowledge"),
];

describe("sortKits", () => {
  test("orders by category, then by name inside a category", () => {
    expect(sortKits(catalog).map((k) => k.name)).toEqual([
      "Code Guardian",
      "llm wiki",
      "Plain Wiki",
      "Inbox Triage",
      "AdaEvolve",
      "ShinkaEvolve",
    ]);
  });

  test("leaves the catalog it was given untouched", () => {
    const rows = [...catalog];
    sortKits(rows);
    expect(rows).toEqual(catalog);
  });
});

describe("categoriesPresent", () => {
  test("keeps only the categories the catalog has, in the same order", () => {
    const withoutProductivity = catalog.filter(
      (k) => k.category !== "productivity",
    );
    expect(categoriesPresent(withoutProductivity)).toEqual([
      "software",
      "knowledge",
      "research",
    ]);
  });
});
