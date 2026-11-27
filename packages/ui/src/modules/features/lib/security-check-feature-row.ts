import type { Brand, FeatureId } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Internal features row that offers the
 * weekly security check. It says in a few plain words who runs the check
 * and where the person chooses how much a check does, which is the
 * assistant's own settings and not this tab. The assistant's name comes
 * from the brand.
 */
export function securityCheckFeatureRow(brand: Brand): {
  id: FeatureId;
  label: string;
  description: string;
} {
  return {
    id: "security-check",
    label: "Security advisory",
    description: `Once a week, ${brand.assistantName} looks for security problems in how your agents are set up, and alerts you when it finds one. Choose how much it checks in ${brand.assistantName}'s settings, under General.`,
  };
}
