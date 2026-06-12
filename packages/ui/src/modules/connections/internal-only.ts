import type { ConnectionTemplateView } from "api-server-api";

// Connections we support but don't want regular users setting up yet.
export const INTERNAL_ONLY_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "spotify",
  "slack",
  "youtube",
]);

// All Google services (catalog ids "google-*") are internal-only as a group.
export const INTERNAL_ONLY_TEMPLATE_ID_PREFIXES: readonly string[] = [
  "google-",
];

export const SHOW_INTERNAL_CONNECTIONS_STORAGE_KEY =
  "platform-debug:show-internal-connections";

export function isInternalOnlyTemplate(id: string): boolean {
  return (
    INTERNAL_ONLY_TEMPLATE_IDS.has(id) ||
    INTERNAL_ONLY_TEMPLATE_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
  );
}

export function isShowInternalConnectionsEnabled(): boolean {
  try {
    return (
      localStorage.getItem(SHOW_INTERNAL_CONNECTIONS_STORAGE_KEY) === "true"
    );
  } catch {
    // localStorage unavailable (private mode) — fail safe toward hidden.
    return false;
  }
}

export function setShowInternalConnections(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem(SHOW_INTERNAL_CONNECTIONS_STORAGE_KEY, "true");
  } else {
    localStorage.removeItem(SHOW_INTERNAL_CONNECTIONS_STORAGE_KEY);
  }
}

// Drops internal-only templates from the offered list unless revealed.
export function filterOfferedTemplates<
  T extends Pick<ConnectionTemplateView, "id">,
>(templates: readonly T[], showInternal: boolean): T[] {
  if (showInternal) return [...templates];
  return templates.filter((t) => !isInternalOnlyTemplate(t.id));
}
