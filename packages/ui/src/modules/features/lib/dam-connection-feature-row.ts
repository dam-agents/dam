import type { Brand, FeatureId } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Experimental features row that offers the
 * Connection letting an agent act as its owner on this install. The name is the
 * install's own, from the brand, and the row says what turning it off does —
 * nothing already made stops working — because that is the question the switch
 * raises.
 */
export function damConnectionFeatureRow(brand: Brand): {
  id: FeatureId;
  label: string;
  description: string;
} {
  return {
    id: "damConnection",
    label: `${brand.name} connection`,
    description: `Let your agents act as you on ${brand.name} through a connection. Turning this off leaves the connections you already made working.`,
  };
}
