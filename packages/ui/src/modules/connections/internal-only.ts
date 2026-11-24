import { type ConnectionTemplateView, DAM_TEMPLATE_ID } from "api-server-api";

const INTERNAL_ONLY_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "spotify",
  "youtube",
  "custom-client-credentials",
]);

const INTERNAL_ONLY_TEMPLATE_ID_PREFIXES: readonly string[] = ["google-"];

export function isInternalOnlyTemplate(id: string): boolean {
  return (
    INTERNAL_ONLY_TEMPLATE_IDS.has(id) ||
    INTERNAL_ONLY_TEMPLATE_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
  );
}

/* UNIT_BOUNDARY_DESCRIPTION: what the catalog offers: the install's own Connection Template only while the person's flag says so — the advanced-connections switch never offers it — and the internal-only templates only for a tester who turned that switch on. */
export function filterOfferedTemplates<
  T extends Pick<ConnectionTemplateView, "id">,
>(templates: readonly T[], showInternal: boolean, damOffered: boolean): T[] {
  const offered = templates.filter(
    (t) => damOffered || t.id !== DAM_TEMPLATE_ID,
  );
  if (showInternal) return offered;
  return offered.filter((t) => !isInternalOnlyTemplate(t.id));
}
