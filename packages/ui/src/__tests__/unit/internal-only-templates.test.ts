import { describe, expect, test } from "vitest";

import { filterOfferedTemplates } from "../../modules/connections/internal-only.js";

describe("filterOfferedTemplates", () => {
  const templates = [
    { id: "github" },
    { id: "slack" },
    { id: "spotify" },
    { id: "google-gmail" },
  ];

  test("offers Slack alongside the other standard templates", () => {
    expect(filterOfferedTemplates(templates, false).map((t) => t.id)).toEqual([
      "github",
      "slack",
    ]);
  });

  test("offers the whole catalog once advanced connections is on", () => {
    expect(filterOfferedTemplates(templates, true).map((t) => t.id)).toEqual(
      templates.map((t) => t.id),
    );
  });
});
