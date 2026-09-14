export interface ConnectionFamily {
  id: string;
  title: string;
  templateIds: readonly string[];
}

export const CONNECTION_FAMILIES: readonly ConnectionFamily[] = [
  {
    id: "github",
    title: "GitHub",
    templateIds: ["github", "github-pat", "github-app"],
  },
  {
    id: "github-enterprise",
    title: "GitHub Enterprise",
    templateIds: [
      "github-enterprise",
      "github-enterprise-pat",
      "github-enterprise-app",
    ],
  },
  { id: "modal", title: "Modal", templateIds: ["modal"] },
  {
    id: "kubernetes",
    title: "Kubernetes / OpenShift",
    templateIds: ["kubernetes"],
  },
  {
    id: "mcp-server",
    title: "MCP servers",
    templateIds: ["custom-mcp-oauth", "custom-mcp-none"],
  },
  {
    id: "custom-header",
    title: "Custom Headers",
    templateIds: ["custom-header"],
  },
];

const FAMILY_BY_ID = new Map(CONNECTION_FAMILIES.map((f) => [f.id, f]));
const FAMILY_BY_TEMPLATE = new Map(
  CONNECTION_FAMILIES.flatMap((f) => f.templateIds.map((t) => [t, f] as const)),
);

export function connectionFamilyById(id: string): ConnectionFamily | undefined {
  return FAMILY_BY_ID.get(id);
}

export function connectionFamilyOf(
  templateId: string,
): ConnectionFamily | undefined {
  return FAMILY_BY_TEMPLATE.get(templateId);
}

export function expandConnectionClass(id: string): readonly string[] {
  return FAMILY_BY_ID.get(id)?.templateIds ?? [id];
}

export function expandConnectionClasses(ids: readonly string[]): Set<string> {
  return new Set(ids.flatMap((id) => [...expandConnectionClass(id)]));
}
