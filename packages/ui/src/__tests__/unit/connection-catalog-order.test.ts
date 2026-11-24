// TEST_OVERVIEW: the Add connection catalog puts the providers the user already holds a connection with first, so adding one of those to another agent is not a scroll, and keeps FAMILY_ORDER for the rest.
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { describe, expect, it } from "vitest";

import { groupCatalog } from "../../modules/connections/lib/catalog-providers.js";

const template = (id: string, familyId: string): ConnectionTemplateView => ({
  id,
  name: id,
  category: "app",
  isCustom: false,
  family: { id: familyId, title: familyId },
  authKind: "header",
  inputs: [],
});

const connection = (name: string, templateId: string): ConnectionView => ({
  id: `conn-${name}`,
  ownerId: "me",
  templateId,
  category: "app",
  name,
  status: "active",
  authKind: "header",
  contributions: [],
  hosts: ["example.com"],
});

const GITHUB = template("github", "github");
const FIGMA = template("figma", "figma");
const DAM = template("dam", "dam");

function apps(connections: readonly ConnectionView[]): string[] {
  const groups = groupCatalog({
    offeredTemplates: [GITHUB, FIGMA, DAM],
    allTemplates: [GITHUB, FIGMA, DAM],
    connections,
  });
  return (groups.get("apps") ?? []).map((g) => g.provider.id);
}

describe("groupCatalog", () => {
  const damConnection = connection("DAM connection", "dam");

  // TEST_SCENARIO: a provider the user already holds a connection with comes before the rest of FAMILY_ORDER, even a family it would otherwise follow.
  it("puts a provider the user holds a connection with first", () => {
    expect(apps([damConnection])[0]).toBe("dam");
  });

  // TEST_SCENARIO: without a connection anywhere, the catalog keeps the order a new user meets the providers in.
  it("keeps FAMILY_ORDER among the providers the user holds nothing on", () => {
    expect(apps([]).indexOf("github")).toBeLessThan(apps([]).indexOf("figma"));
  });
});
