import type { Brand, FeatureId } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Experimental features row that offers the
 * weekly security check. It says who runs the check and that each run spends
 * the person's own model budget, which is why the check waits for this
 * switch. The assistant's name comes from the brand.
 */
export function securityCheckFeatureRow(brand: Brand): {
  id: FeatureId;
  label: string;
  description: string;
} {
  return {
    id: "security-check",
    label: "Security check",
    description: `${brand.assistantName} checks your setup once a week against the security advisory, and alerts you when something puts your accounts at risk. Each check is a scheduled run of ${brand.assistantName}, so it spends your model budget. You can change its time in ${brand.assistantName}'s schedules.`,
  };
}
