import { describe, expect, it } from "vitest";

import { createAgentFavicon } from "../../modules/artifact-library/infrastructure/agent-favicon.js";

describe("agent favicon", () => {
  // TEST_SCENARIO: A character or emoji avatar becomes an inline SVG; an Agent that is gone, or belongs to someone else, gives no icon so the page keeps the brand icon.
  it("inlines the avatar and gives nothing for a missing Agent", async () => {
    const favicon = createAgentFavicon({
      getAgent: (id, owner) =>
        Promise.resolve(
          owner !== "o1"
            ? null
            : id === "bee"
              ? { name: "Bee", spec: { avatar: "emoji:🐝" } }
              : id === "plain"
                ? { name: "Plain", spec: {} }
                : null,
        ),
      loadImage: () => Promise.resolve(null),
    });
    expect(await favicon("bee", "o1")).toBe(
      `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="54" font-size="80" text-anchor="middle" dominant-baseline="central">🐝</text></svg>',
      )}`,
    );
    expect(await favicon("plain", "o1")).toMatch(/^data:image\/svg\+xml,/);
    expect(await favicon("gone", "o1")).toBeNull();
    expect(await favicon("bee", "o2")).toBeNull();
  });
});
