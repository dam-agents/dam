// TEST_OVERVIEW: the kit browser lists starter kits in one fixed order — Software,
// TEST_OVERVIEW: Knowledge, Productivity, Research — and alphabetically by name inside a
// TEST_OVERVIEW: category, whatever order the resolved catalog rows arrived in.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  categoriesPresent,
  sortKits,
  splitPinned,
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

describe("splitPinned", () => {
  const pinnedCatalog = sortKits(catalog).map((k) =>
    k.name === "Inbox Triage" ? { ...k, pinned: true } : k,
  );

  // TEST_SCENARIO: the All view leads with the pinned kit and keeps the rest in catalog order, without showing the pinned kit twice.
  test("lifts the pinned kit out of the All view", () => {
    const { pinned, rest } = splitPinned(pinnedCatalog, {
      filter: "all",
      query: "",
    });
    expect(pinned?.name).toBe("Inbox Triage");
    expect(rest.map((k) => k.name)).toEqual([
      "Code Guardian",
      "llm wiki",
      "Plain Wiki",
      "AdaEvolve",
      "ShinkaEvolve",
    ]);
  });

  // TEST_SCENARIO: a category tab and a search show peers side by side, so the pinned kit is an ordinary card there even when it matches.
  test("pins nothing on a category tab or in search results", () => {
    const inCategory = pinnedCatalog.filter(
      (k) => k.category === "productivity",
    );
    expect(
      splitPinned(inCategory, { filter: "productivity", query: "" }).pinned,
    ).toBeUndefined();
    expect(
      splitPinned(pinnedCatalog, { filter: "all", query: "inbox" }).pinned,
    ).toBeUndefined();
  });

  // TEST_SCENARIO: with no kit flagged — no pin set, or the pinned kit is not served — the All view shows every card at the same size.
  test("pins nothing when no kit is flagged", () => {
    const { pinned, rest } = splitPinned(sortKits(catalog), {
      filter: "all",
      query: "",
    });
    expect(pinned).toBeUndefined();
    expect(rest).toHaveLength(catalog.length);
  });
});
