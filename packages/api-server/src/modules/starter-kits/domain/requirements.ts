import type {
  StarterKit,
  StarterKitConnectionRequirement,
} from "api-server-api";

export interface GrantedTemplate {
  templateId: string;
  familyId?: string;
}

export function satisfiesRequirement(
  requirement: StarterKitConnectionRequirement,
  granted: readonly GrantedTemplate[],
): boolean {
  return granted.some(
    (g) =>
      requirement.accepts.includes(g.templateId) ||
      (g.familyId !== undefined && requirement.accepts.includes(g.familyId)),
  );
}

export function unmetRequiredConnections(
  kit: StarterKit,
  granted: readonly GrantedTemplate[],
): StarterKitConnectionRequirement[] {
  return kit.connections.filter(
    (req) => req.required && !satisfiesRequirement(req, granted),
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
