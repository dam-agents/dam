/**
 * Fixture-derived inputs for connection component stories. Groups are built
 * with the real `groupCatalog`, exactly as `useCatalogGroups` does in the app.
 */
import type { ConnectionView } from "api-server-api";

import {
  type CatalogProviderGroup,
  groupCatalog,
} from "@/modules/connections/lib/catalog-providers";

import { CONNECTIONS, TEMPLATES } from "../../backend/fixtures/connections";

export const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

const BY_TAB = groupCatalog({
  offeredTemplates: TEMPLATES,
  allTemplates: TEMPLATES,
  connections: CONNECTIONS,
});

export function groupFor(providerId: string): CatalogProviderGroup {
  const group = [...BY_TAB.values()]
    .flat()
    .find((g) => g.provider.id === providerId);
  if (!group) throw new Error(`No catalog group "${providerId}"`);
  return group;
}

export function connectionById(id: string): ConnectionView {
  const found = CONNECTIONS.find((c) => c.id === id);
  if (!found) throw new Error(`No fixture connection "${id}"`);
  return found;
}

/** The fixture GitHub OAuth connection with an app slug set, which is the
 *  state that asks the user to install the GitHub App. No fixture has one. */
export const GITHUB_NEEDS_INSTALL: ConnectionView = {
  ...connectionById("conn-github"),
  appSlug: "acme-agents",
};

/** No fixture connection uses the GitHub App template. This is the fixture
 *  GitHub connection re-shaped as one, narrowed to a repository and two
 *  permissions, for the scope-editing dialog. */
export const GITHUB_APP_CONNECTION: ConnectionView = {
  ...connectionById("conn-github"),
  id: "conn-github-app",
  templateId: "github-app",
  name: "github-app",
  authKind: "github-app",
  githubUserToken: undefined,
  githubAppScope: {
    repositories: ["checkout-service"],
    permissions: { contents: "write", pull_requests: "write" },
  },
};
