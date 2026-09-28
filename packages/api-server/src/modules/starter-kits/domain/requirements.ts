import {
  requirementAccepts,
  type StarterKit,
  type StarterKitConnectionRequirement,
} from "api-server-api";

export interface GrantedTemplate {
  templateId: string;
  familyId?: string;
}

export function satisfiesRequirement(
  requirement: StarterKitConnectionRequirement,
  granted: readonly GrantedTemplate[],
): boolean {
  return granted.some((g) =>
    requirementAccepts(requirement, g.templateId, g.familyId),
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
