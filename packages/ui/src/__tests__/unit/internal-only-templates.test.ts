import { describe, expect, test } from "vitest";

import {
  filterOfferedTemplates,
  isInternalOnlyTemplate,
} from "../../modules/connections/internal-only.js";

describe("isInternalOnlyTemplate", () => {
  test("Slack is a standard template, offered without the flag", () => {
    expect(isInternalOnlyTemplate("slack")).toBe(false);
  });

  test.each(["spotify", "youtube", "custom-client-credentials"])(
    "%s stays behind the flag",
    (id) => {
      expect(isInternalOnlyTemplate(id)).toBe(true);
    },
  );

  test.each(["google-gmail", "google-drive"])(
    "%s stays behind the flag, matched by prefix",
    (id) => {
      expect(isInternalOnlyTemplate(id)).toBe(true);
    },
  );

  test.each([
    "github",
    "github-pat",
    "github-app",
    "github-enterprise-pat",
    "github-enterprise-app",
    "custom-mcp-oauth",
  ])("%s is offered without the flag", (id) => {
    expect(isInternalOnlyTemplate(id)).toBe(false);
  });
});

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
