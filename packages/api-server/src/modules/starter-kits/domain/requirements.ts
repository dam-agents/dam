import {
  expandConnectionClasses,
  type StarterKit,
  type StarterKitConnectionRequirement,
} from "api-server-api";

export function unmetRequiredConnections(
  kit: StarterKit,
  grantedTemplateIds: Iterable<string>,
): StarterKitConnectionRequirement[] {
  const granted = new Set(grantedTemplateIds);
  return kit.connections.filter(
    (req) =>
      req.required &&
      ![...expandConnectionClasses(req.accepts)].some((t) => granted.has(t)),
  );
}

export function kitRef(kitId: string, version: string): string {
  return `${kitId}@${version}`;
}

export function parseKitRef(
  ref: string,
): { kitId: string; version: string } | null {
  const at = ref.lastIndexOf("@");
  if (at <= 0 || at === ref.length - 1) return null;
  return { kitId: ref.slice(0, at), version: ref.slice(at + 1) };
}
