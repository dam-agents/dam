// TEST_OVERVIEW: the starter kits page is addressable by category —
// TEST_OVERVIEW: /starter-kits/knowledge opens the catalog on its Knowledge
// TEST_OVERVIEW: shelf — while an unknown segment falls back to the whole
// TEST_OVERVIEW: catalog and a kit's own two-segment path is left alone.
import { describe, expect, test } from "vitest";

import {
  parseRoute,
  routeToNavigationState,
  routeToPath,
} from "../../modules/platform/lib/routes.js";

describe("starter kits category route", () => {
  test("a category segment selects that shelf, and round-trips", () => {
    const route = parseRoute("/starter-kits/knowledge");
    expect(route).toEqual({ view: "starter-kits", category: "knowledge" });
    expect(routeToPath(route)).toBe("/starter-kits/knowledge");
    expect(routeToNavigationState(route).starterKitCategory).toBe("knowledge");
  });

  test("the bare page has no category", () => {
    const route = parseRoute("/starter-kits");
    expect(route).toEqual({ view: "starter-kits" });
    expect(routeToPath(route)).toBe("/starter-kits");
    expect(routeToNavigationState(route).starterKitCategory).toBeNull();
  });

  test("an unknown segment opens the whole catalog rather than a broken page", () => {
    expect(parseRoute("/starter-kits/not-a-category")).toEqual({
      view: "starter-kits",
    });
  });

  test("a kit's own path is still a kit, never a category", () => {
    expect(parseRoute("/starter-kits/platform/llm-wiki")).toEqual({
      view: "starter-kit",
      catalog: "platform",
      kit: "llm-wiki",
    });
    expect(
      routeToNavigationState(parseRoute("/starter-kits/platform/llm-wiki"))
        .starterKitCategory,
    ).toBeNull();
  });
});
