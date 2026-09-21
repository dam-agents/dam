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

export interface CatalogProvider {
  id: string;
  title: string;
  iconSlug: string | undefined;
  tab: CatalogTab;
}

export interface CatalogProviderGroup {
  provider: CatalogProvider;
  templates: ConnectionTemplateView[];
  connections: ConnectionView[];
}

const FAMILY_TAB: Record<string, CatalogTab> = {
  "mcp-server": "mcp",
  "custom-header": "custom-headers",
};

const FAMILY_ORDER: readonly string[] = [
  "github",
  "github-enterprise",
  "modal",
  "kubernetes",
];

export function catalogProviderTitle(
  template: Pick<ConnectionTemplateView, "family"> | undefined,
): string | undefined {
  return template?.family?.title;
}

const METHOD_COPY: Record<string, { title: string; description: string }> = {
  github: {
    title: "Authorize with GitHub",
    description:
      "Connect by logging in with your GitHub account — no token to create or paste",
  },
  "github-pat": {
    title: "Connect with a personal access token",
    description:
      "Paste a token you create on GitHub. Best when finer-grained access is preferred",
  },
  "github-app": {
    title: "Connect your GitHub App",
    description: "Agents act as a bot and your org owns the app",
  },
  "github-enterprise": {
    title: "Authorize with GitHub Enterprise",
    description:
      "Connect by logging in on your GitHub Enterprise host — no token to create or paste",
  },
  "github-enterprise-pat": {
    title: "Connect with a personal access token",
    description:
      "Paste a token you create on GitHub. Best when finer-grained access is preferred",
  },
  "github-enterprise-app": {
    title: "Connect your GitHub App",
    description: "Agents act as a bot and your org owns the app",
  },
};

export function templateMethodCopy(template: ConnectionTemplateView): {
  title: string;
  description: string;
} {
  return (
    METHOD_COPY[template.id] ?? {
      title: template.name,
      description: template.description ?? "",
    }
  );
}

export function templateCreateHeading(template: ConnectionTemplateView): {
  title: string;
} {
  return { title: `Add ${template.name}` };
}

const SUBMIT_LABELS: Record<string, { label: string; external?: boolean }> = {
  github: { label: "Continue to GitHub", external: true },
  "github-enterprise": { label: "Continue to GitHub", external: true },
  "github-pat": { label: "Create token" },
  "github-enterprise-pat": { label: "Create token" },
  "github-app": { label: "Connect app" },
  "github-enterprise-app": { label: "Connect app" },
};

export function templateSubmitLabel(
  templateId: string,
): { label: string; external?: boolean } | undefined {
  return SUBMIT_LABELS[templateId];
}

const tabForCategory = (
  category: ConnectionTemplateView["category"],
): CatalogTab => (category === "mcp" ? "mcp" : "apps");

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

  const groups = new Map<string, CatalogProviderGroup>();
  const groupFor = (templateId: string): CatalogProviderGroup => {
    const template = templateById.get(templateId);
    const family = template?.family;
    const providerId = family?.id ?? templateId;
    const existing = groups.get(providerId);
    if (existing) {
      if (!existing.provider.iconSlug && template?.iconSlug)
        existing.provider.iconSlug = template.iconSlug;
      return existing;
    }
    const provider: CatalogProvider = family
      ? {
          id: family.id,
          title: family.title,
          iconSlug: template?.iconSlug,
          tab:
            FAMILY_TAB[family.id] ??
            (template ? tabForCategory(template.category) : "apps"),
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

  for (const t of offeredTemplates) groupFor(t.id).templates.push(t);
  for (const c of connections) groupFor(c.templateId).connections.push(c);

  const rank = (g: CatalogProviderGroup) => {
    const i = FAMILY_ORDER.indexOf(g.provider.id);
    return i === -1 ? FAMILY_ORDER.length : i;
  };
  const byTab = new Map<CatalogTab, CatalogProviderGroup[]>(
    CATALOG_TAB_ORDER.map((tab) => [tab, []]),
  );
  for (const group of groups.values())
    byTab.get(group.provider.tab)!.push(group);
  for (const list of byTab.values()) list.sort((a, b) => rank(a) - rank(b));
  return byTab;
}

export function catalogTabCounts(
  byTab: Map<CatalogTab, CatalogProviderGroup[]>,
): Record<CatalogTab, number> {
  const counts = Object.fromEntries(
    CATALOG_TAB_ORDER.map((tab) => [tab, 0]),
  ) as Record<CatalogTab, number>;
  for (const [tab, groups] of byTab)
    counts[tab] = groups.reduce((n, g) => n + g.connections.length, 0);
  return counts;
}

export function connectionKindSubtitle(
  connection: ConnectionView,
  template: ConnectionTemplateView | undefined,
): string {
  if (
    connection.templateId === "github" ||
    connection.templateId === "github-enterprise"
  )
    return "GitHub OAuth";
  if (
    connection.templateId === "github-app" ||
    connection.templateId === "github-enterprise-app"
  )
    return "GitHub App";
  if (
    connection.templateId === "github-pat" ||
    connection.templateId === "github-enterprise-pat"
  )
    return "GitHub PAT";
  const host = connection.host ?? connection.hosts[0];
  if (
    host &&
    (connection.category === "mcp" || connection.authKind === "header")
  )
    return host;
  return template?.name ?? connection.templateId;
}

export function filterGroupsByAccepts(
  groups: readonly CatalogProviderGroup[],
  accepts: readonly string[],
): CatalogProviderGroup[] {
  const wanted = new Set(accepts);
  return groups.flatMap((group) => {
    if (wanted.has(group.provider.id)) return [group];
    const templates = group.templates.filter((t) => wanted.has(t.id));
    const connections = group.connections.filter((c) =>
      wanted.has(c.templateId),
    );
    if (templates.length === 0 && connections.length === 0) return [];
    return [{ ...group, templates, connections }];
  });
}
