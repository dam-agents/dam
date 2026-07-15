import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

export type CatalogTab = "apps" | "mcp" | "custom-headers";

export const CATALOG_TAB_ORDER: readonly CatalogTab[] = [
  "apps",
  "mcp",
  "custom-headers",
];

export const CATALOG_TAB_LABEL: Record<CatalogTab, string> = {
  apps: "Apps",
  mcp: "MCP servers",
  "custom-headers": "Custom Headers",
};

/** A catalogue card: one product a user can connect to, possibly backed by
 *  several templates (e.g. GitHub's OAuth app + personal access token). */
export interface CatalogProvider {
  id: string;
  title: string;
  iconSlug: string | undefined;
  tab: CatalogTab;
}

export interface CatalogProviderGroup {
  provider: CatalogProvider;
  /** Offered templates behind `New`; empty when the template is hidden. */
  templates: ConnectionTemplateView[];
  connections: ConnectionView[];
}

// Curated grouping so sibling templates share one card; any template not
// listed becomes a singleton provider derived from the template itself.
const STATIC_PROVIDERS: readonly {
  id: string;
  title: string;
  templateIds: readonly string[];
  tab: CatalogTab;
}[] = [
  {
    id: "github",
    title: "GitHub",
    templateIds: ["github", "github-pat"],
    tab: "apps",
  },
  {
    id: "github-enterprise",
    title: "GitHub Enterprise",
    templateIds: ["github-enterprise"],
    tab: "apps",
  },
  { id: "modal", title: "Modal", templateIds: ["modal"], tab: "apps" },
  {
    id: "kubernetes",
    title: "Kubernetes / OpenShift",
    templateIds: ["kubernetes"],
    tab: "apps",
  },
  {
    id: "mcp-server",
    title: "MCP servers",
    templateIds: ["custom-mcp-oauth", "custom-mcp-none"],
    tab: "mcp",
  },
  {
    id: "custom-header",
    title: "Custom Headers",
    templateIds: ["custom-header"],
    tab: "custom-headers",
  },
];

const STATIC_TITLE_BY_TEMPLATE_ID = new Map(
  STATIC_PROVIDERS.flatMap((p) => p.templateIds.map((id) => [id, p.title])),
);

/** Curated provider title, e.g. "GitHub" for `github-pat`. */
export function catalogProviderTitle(templateId: string): string | undefined {
  return STATIC_TITLE_BY_TEMPLATE_ID.get(templateId);
}

const tabForCategory = (
  category: ConnectionTemplateView["category"],
): CatalogTab => (category === "mcp" ? "mcp" : "apps");

/** Groups offered templates and existing connections into provider cards per
 *  tab: curated providers first, then singletons in catalog order.
 *  Connections of hidden templates still get a card, without `New`. */
export function groupCatalog({
  offeredTemplates,
  allTemplates,
  connections,
}: {
  offeredTemplates: readonly ConnectionTemplateView[];
  allTemplates: readonly ConnectionTemplateView[];
  connections: readonly ConnectionView[];
}): Map<CatalogTab, CatalogProviderGroup[]> {
  const templateById = new Map(allTemplates.map((t) => [t.id, t]));
  const staticByTemplateId = new Map(
    STATIC_PROVIDERS.flatMap((p) => p.templateIds.map((id) => [id, p] as const)),
  );

  const groups = new Map<string, CatalogProviderGroup>();
  const groupFor = (templateId: string): CatalogProviderGroup => {
    const def = staticByTemplateId.get(templateId);
    const providerId = def?.id ?? templateId;
    const existing = groups.get(providerId);
    if (existing) return existing;
    const template = templateById.get(templateId);
    const provider: CatalogProvider = def
      ? {
          id: def.id,
          title: def.title,
          iconSlug: def.templateIds
            .map((id) => templateById.get(id)?.iconSlug)
            .find(Boolean),
          tab: def.tab,
        }
      : {
          id: templateId,
          title: template?.name ?? templateId,
          iconSlug: template?.iconSlug,
          tab: template ? tabForCategory(template.category) : "apps",
        };
    const group: CatalogProviderGroup = {
      provider,
      templates: [],
      connections: [],
    };
    groups.set(providerId, group);
    return group;
  };

  const offeredIds = new Set(offeredTemplates.map((t) => t.id));
  for (const def of STATIC_PROVIDERS)
    if (def.templateIds.some((id) => offeredIds.has(id)))
      groupFor(def.templateIds.find((id) => offeredIds.has(id))!);
  for (const t of offeredTemplates) groupFor(t.id).templates.push(t);
  for (const c of connections) groupFor(c.templateId).connections.push(c);

  const byTab = new Map<CatalogTab, CatalogProviderGroup[]>(
    CATALOG_TAB_ORDER.map((tab) => [tab, []]),
  );
  for (const group of groups.values())
    byTab.get(group.provider.tab)!.push(group);
  return byTab;
}

export function catalogTabCounts(
  byTab: Map<CatalogTab, CatalogProviderGroup[]>,
): Record<CatalogTab, number> {
  const counts = { apps: 0, mcp: 0, "custom-headers": 0 };
  for (const [tab, groups] of byTab)
    counts[tab] = groups.reduce((n, g) => n + g.connections.length, 0);
  return counts;
}

/** One-line row subtitle describing what kind of credential this is —
 *  auth flavor for GitHub, the endpoint for MCP/header connections. */
export function connectionKindSubtitle(
  connection: ConnectionView,
  template: ConnectionTemplateView | undefined,
): string {
  if (
    connection.templateId === "github" ||
    connection.templateId === "github-enterprise"
  )
    return "GitHub app";
  if (connection.templateId === "github-pat") return "Personal access token";
  const host = connection.host ?? connection.hosts[0];
  if (host && (connection.category === "mcp" || connection.authKind === "header"))
    return host;
  return template?.name ?? connection.templateId;
}
