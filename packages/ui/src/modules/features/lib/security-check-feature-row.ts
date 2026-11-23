import type { Brand, FeatureId } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Experimental features row that offers the
 * weekly security check. It says who runs the check and where the person
 * chooses how much a check does, which is the assistant's own settings and
 * not this tab. The assistant's name comes from the brand.
 */
export function securityCheckFeatureRow(brand: Brand): {
  id: FeatureId;
  label: string;
  description: string;
} {
  return {
    id: "security-check",
    label: "Security check",
    description: `${brand.assistantName} checks your setup once a week against the security advisory, and alerts you when something puts your accounts at risk. A check runs no turn on your other agents unless you choose that. You choose how much a check does in ${brand.assistantName}'s settings, under General, and its time in ${brand.assistantName}'s schedules.`,
  };
}
