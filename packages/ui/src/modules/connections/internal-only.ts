import { type ConnectionTemplateView, DAM_TEMPLATE_ID } from "api-server-api";

const INTERNAL_ONLY_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "spotify",
  "youtube",
  "custom-client-credentials",
]);

const INTERNAL_ONLY_TEMPLATE_ID_PREFIXES: readonly string[] = ["google-"];

const NEVER_OFFERED_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  DAM_TEMPLATE_ID,
]);

export function isInternalOnlyTemplate(id: string): boolean {
  return (
    INTERNAL_ONLY_TEMPLATE_IDS.has(id) ||
    INTERNAL_ONLY_TEMPLATE_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
  );
}

export function filterOfferedTemplates<
  T extends Pick<ConnectionTemplateView, "id">,
>(templates: readonly T[], showInternal: boolean): T[] {
  const neverOffered = templates.filter(
    (t) => !NEVER_OFFERED_TEMPLATE_IDS.has(t.id),
  );
  if (showInternal) return neverOffered;
  return neverOffered.filter((t) => !isInternalOnlyTemplate(t.id));
}
