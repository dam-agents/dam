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

export function kitRef(
  catalog: string,
  kitId: string,
  version: string,
): string {
  return `${catalog}/${kitId}@${version}`;
}

export function parseKitRef(
  ref: string,
): { catalog: string; kitId: string; version: string } | null {
  const at = ref.lastIndexOf("@");
  if (at <= 0 || at === ref.length - 1) return null;
  const path = ref.slice(0, at);
  const slash = path.indexOf("/");
  if (slash <= 0 || slash === path.length - 1) return null;
  return {
    catalog: path.slice(0, slash),
    kitId: path.slice(slash + 1),
    version: ref.slice(at + 1),
  };
}
