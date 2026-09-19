// TEST_OVERVIEW: a kit requirement narrows the connection catalogue — a family
// TEST_OVERVIEW: id keeps its provider group whole, a template id keeps only that
// TEST_OVERVIEW: template and its connections, and unrelated groups disappear.
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  type CatalogProviderGroup,
  filterGroupsByAccepts,
} from "../../modules/connections/lib/catalog-providers.js";

const template = (id: string, family: string) =>
  ({
    id,
    name: id,
    family: { id: family, title: family },
  }) as unknown as ConnectionTemplateView;
const connection = (id: string, templateId: string) =>
  ({ id, templateId }) as unknown as ConnectionView;
const group = (
  id: string,
  templates: ConnectionTemplateView[],
  connections: ConnectionView[],
): CatalogProviderGroup => ({
  provider: { id, title: id, iconSlug: undefined, tab: "apps" },
  templates,
  connections,
});

const github = group(
  "github",
  [template("github", "github"), template("github-pat", "github")],
  [connection("c1", "github"), connection("c2", "github-pat")],
);
const ghe = group(
  "github-enterprise",
  [template("github-enterprise", "github-enterprise")],
  [connection("c3", "github-enterprise")],
);
const slack = group(
  "slack",
  [template("slack", "slack")],
  [connection("c4", "slack")],
);
const all = [github, ghe, slack];

describe("filterGroupsByAccepts", () => {
  test("a family id keeps its whole group", () => {
    expect(
      filterGroupsByAccepts(all, ["github", "github-enterprise"]).map(
        (g) => g.provider.id,
      ),
    ).toEqual(["github", "github-enterprise"]);
  });

  test("a template id narrows the group to that template and its connections", () => {
    const [pat] = filterGroupsByAccepts(all, ["github-pat"]);
    expect(pat.provider.id).toBe("github");
    expect(pat.templates.map((t) => t.id)).toEqual(["github-pat"]);
    expect(pat.connections.map((c) => c.id)).toEqual(["c2"]);
  });

  test("drops the groups nothing accepts", () => {
    expect(
      filterGroupsByAccepts(all, ["slack"]).map((g) => g.provider.id),
    ).toEqual(["slack"]);
    expect(filterGroupsByAccepts(all, ["nope"])).toEqual([]);
  });
});
