import type { ConnectionTemplateView } from "api-server-api";

// Connections we support but don't want regular users setting up yet.
export const INTERNAL_ONLY_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "spotify",
  "slack",
  "youtube",
  "custom-client-credentials",
  "github-app",
  "github-enterprise-app",
]);

// All Google services (catalog ids "google-*") are internal-only as a group.
export const INTERNAL_ONLY_TEMPLATE_ID_PREFIXES: readonly string[] = [
  "google-",
];

export function isInternalOnlyTemplate(id: string): boolean {
  return (
    INTERNAL_ONLY_TEMPLATE_IDS.has(id) ||
    INTERNAL_ONLY_TEMPLATE_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
  );
}

// Drops internal-only templates from the offered list unless the
// advanced-connections feature is enabled for the user.
export function filterOfferedTemplates<
  T extends Pick<ConnectionTemplateView, "id">,
>(templates: readonly T[], showInternal: boolean): T[] {
  if (showInternal) return [...templates];
  return templates.filter((t) => !isInternalOnlyTemplate(t.id));
}
