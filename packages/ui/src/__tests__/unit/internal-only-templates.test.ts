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
    expect(
      filterOfferedTemplates(templates, false, false).map((t) => t.id),
    ).toEqual(["github", "slack"]);
  });

  test("offers the whole catalog once advanced connections is on", () => {
    expect(
      filterOfferedTemplates(templates, true, false).map((t) => t.id),
    ).toEqual(templates.map((t) => t.id));
  });

  // TEST_SCENARIO: the install's own Connection Template is on offer only while the person's flag says so — the advanced-connections switch never offers it, because its credential is the platform's and the person does not type one.
  test("offers the install's own template only while its flag is on", () => {
    const withDam = [...templates, { id: "dam" }];
    expect(
      filterOfferedTemplates(withDam, false, false).map((t) => t.id),
    ).toEqual(["github", "slack"]);
    expect(
      filterOfferedTemplates(withDam, true, false).map((t) => t.id),
    ).toEqual(templates.map((t) => t.id));
    expect(
      filterOfferedTemplates(withDam, false, true).map((t) => t.id),
    ).toEqual(["github", "slack", "dam"]);
  });
});
